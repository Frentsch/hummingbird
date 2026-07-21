package sui

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/block-vision/sui-go-sdk/common/grpcconn"
	"github.com/block-vision/sui-go-sdk/models"
	v2 "github.com/block-vision/sui-go-sdk/pb/sui/rpc/v2"
	"github.com/block-vision/sui-go-sdk/signer"
	"github.com/block-vision/sui-go-sdk/transaction"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
)

// Client wraps the Sui gRPC endpoint and a signing keypair.
type Client struct {
	grpc      *grpcconn.SuiGrpcClient
	kp        *Keypair
	gasBudget uint64
}

// NewClient creates a client for the Sui gRPC endpoint at target (host:port,
// e.g. "fullnode.testnet.sui.io:443"). The connection is established lazily
// on first use.
func NewClient(target string, kp *Keypair, gasBudget uint64) *Client {
	grpcClient := grpcconn.NewSuiGrpcClient(target, grpcconn.WithDialOptions(
		grpc.WithTransportCredentials(credentials.NewTLS(nil)),
	))
	return &Client{
		grpc:      grpcClient,
		kp:        kp,
		gasBudget: gasBudget,
	}
}

// Close releases the underlying gRPC connection.
func (c *Client) Close() error {
	return c.grpc.Close()
}

// resolveObjectArg fetches an object's current reference from the ledger and
// builds the CallArg needed to pass it into a Move call, distinguishing
// shared objects (which need their initial shared version) from owned
// objects (which need an exact version + digest).
func resolveObjectArg(ctx context.Context, ledger v2.LedgerServiceClient, objectID string) (transaction.CallArg, error) {
	resp, err := ledger.GetObject(ctx, &v2.GetObjectRequest{
		ObjectId: &objectID,
		ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"object_id", "version", "digest", "owner"}},
	})
	if err != nil {
		return transaction.CallArg{}, fmt.Errorf("get object %s: %w", objectID, err)
	}
	obj := resp.GetObject()

	addrBytes, err := transaction.ConvertSuiAddressStringToBytes(models.SuiAddress(obj.GetObjectId()))
	if err != nil {
		return transaction.CallArg{}, fmt.Errorf("parse object id %s: %w", objectID, err)
	}

	if obj.GetOwner().GetKind() == v2.Owner_SHARED {
		return transaction.CallArg{Object: &transaction.ObjectArg{
			SharedObject: &transaction.SharedObjectRef{
				ObjectId:             *addrBytes,
				InitialSharedVersion: obj.GetOwner().GetVersion(),
				Mutable:              true,
			},
		}}, nil
	}

	digestBytes, err := transaction.ConvertObjectDigestStringToBytes(models.ObjectDigest(obj.GetDigest()))
	if err != nil {
		return transaction.CallArg{}, fmt.Errorf("parse object digest %s: %w", objectID, err)
	}
	return transaction.CallArg{Object: &transaction.ObjectArg{
		ImmOrOwnedObject: &transaction.SuiObjectRef{
			ObjectId: *addrBytes,
			Version:  obj.GetVersion(),
			Digest:   *digestBytes,
		},
	}}, nil
}

// fetchGasPrice returns the current reference gas price.
func fetchGasPrice(ctx context.Context, ledger v2.LedgerServiceClient) (uint64, error) {
	resp, err := ledger.GetEpoch(ctx, &v2.GetEpochRequest{
		ReadMask: &fieldmaskpb.FieldMask{Paths: []string{"reference_gas_price"}},
	})
	if err != nil {
		return 0, fmt.Errorf("GetEpoch: %w", err)
	}
	return resp.GetEpoch().GetReferenceGasPrice(), nil
}

// fetchGasCoin returns a SUI coin owned by address, suitable as gas payment.
func fetchGasCoin(ctx context.Context, state v2.StateServiceClient, address string) (*transaction.SuiObjectRef, error) {
	coinType := "0x2::coin::Coin<0x2::sui::SUI>"
	pageSize := uint32(1)
	resp, err := state.ListOwnedObjects(ctx, &v2.ListOwnedObjectsRequest{
		Owner:      &address,
		ObjectType: &coinType,
		PageSize:   &pageSize,
		ReadMask: &fieldmaskpb.FieldMask{
			Paths: []string{"object_id", "version", "digest"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("ListOwnedObjects: %w", err)
	}
	if len(resp.Objects) == 0 {
		return nil, fmt.Errorf("no SUI coins found for address %s", address)
	}

	obj := resp.Objects[0]
	return transaction.NewSuiObjectRef(
		models.SuiAddress(obj.GetObjectId()),
		fmt.Sprintf("%d", obj.GetVersion()),
		models.ObjectDigest(obj.GetDigest()),
	)
}

// RegisterAsFor builds, signs, and executes registry::register_as_for on-chain.
// Returns the object ID of the created AsAuthCap on success.
func (c *Client) RegisterAsFor(packageID, globalRegistryID, marketAdminCapID string, isdAsID uint64, recipient string) (string, error) {
	ctx := context.Background()

	ledgerService, err := c.grpc.LedgerService(ctx)
	if err != nil {
		return "", fmt.Errorf("ledger service: %w", err)
	}
	stateService, err := c.grpc.StateService(ctx)
	if err != nil {
		return "", fmt.Errorf("state service: %w", err)
	}
	txService, err := c.grpc.TransactionExecutionService(ctx)
	if err != nil {
		return "", fmt.Errorf("transaction execution service: %w", err)
	}

	registryArg, err := resolveObjectArg(ctx, ledgerService, globalRegistryID)
	if err != nil {
		return "", fmt.Errorf("resolve registry object: %w", err)
	}
	capArg, err := resolveObjectArg(ctx, ledgerService, marketAdminCapID)
	if err != nil {
		return "", fmt.Errorf("resolve market admin cap object: %w", err)
	}
	gasPrice, err := fetchGasPrice(ctx, ledgerService)
	if err != nil {
		return "", fmt.Errorf("fetch gas price: %w", err)
	}
	gasCoin, err := fetchGasCoin(ctx, stateService, c.kp.SuiAddress)
	if err != nil {
		return "", fmt.Errorf("fetch gas coin: %w", err)
	}

	tx := transaction.NewTransaction()
	tx.SetSigner(signer.NewSigner(c.kp.PrivKey.Seed()))
	tx.SetGasPrice(gasPrice)
	tx.SetGasBudget(c.gasBudget)
	tx.SetGasPayment([]transaction.SuiObjectRef{*gasCoin})
	exp := time.Now().Add(time.Hour * 24 * 30).Unix() * 1000;
	tx.MoveCall(models.SuiAddress(packageID), "registry", "register_as_for", nil, []transaction.Argument{
		tx.Object(capArg),
		tx.Object(registryArg),
		tx.Pure(isdAsID),
		tx.Pure(exp), //time now + 30 days as uint64
		tx.Pure(recipient),
	})

	txBytes, err := tx.BuildBCSBytes(ctx)
	if err != nil {
		return "", fmt.Errorf("build transaction: %w", err)
	}

	sig := SignForSui(c.kp, txBytes)
	sigBytes, err := base64.StdEncoding.DecodeString(sig)
	if err != nil {
		return "", fmt.Errorf("decode signature: %w", err)
	}

	resp, err := txService.ExecuteTransaction(ctx, &v2.ExecuteTransactionRequest{
		Transaction: &v2.Transaction{Bcs: &v2.Bcs{Value: txBytes}},
		Signatures:  []*v2.UserSignature{{Bcs: &v2.Bcs{Value: sigBytes}}},
		ReadMask: &fieldmaskpb.FieldMask{
			Paths: []string{
				"effects.status",
				"effects.changed_objects.object_id",
				"effects.changed_objects.id_operation",
				"objects.objects.object_id",
				"objects.objects.object_type",
			},
		},
	})
	if err != nil {
		return "", fmt.Errorf("execute transaction: %w", err)
	}

	executed := resp.GetTransaction()
	if status := executed.GetEffects().GetStatus(); status != nil && !status.GetSuccess() {
		return "", fmt.Errorf("transaction failed: %s", status.GetError())
	}

	created := make(map[string]bool)
	for _, ch := range executed.GetEffects().GetChangedObjects() {
		if ch.GetIdOperation() == v2.ChangedObject_CREATED {
			created[ch.GetObjectId()] = true
		}
	}

	suffix := packageID + "::registry::AsAuthCap"
	for _, obj := range executed.GetObjects().GetObjects() {
		if created[obj.GetObjectId()] && strings.HasSuffix(obj.GetObjectType(), suffix) {
			return obj.GetObjectId(), nil
		}
	}
	return "", fmt.Errorf("AsAuthCap not found in transaction effects")
}
