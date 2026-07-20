package server

import (
	"context"
	"crypto/ecdsa"
	"crypto/sha256"
	"fmt"

	"connectrpc.com/connect"
	cppb "github.com/scionproto/scion/hummingbird/auth-server/gen/control_plane/v1"
	cryptopb "github.com/scionproto/scion/hummingbird/auth-server/gen/crypto/v1"
	v1 "github.com/scionproto/scion/hummingbird/auth-server/gen/hummingbird/v1"
	"github.com/scionproto/scion/hummingbird/auth-server/gen/hummingbird/v1/hummingbirdconnect"
	"github.com/scionproto/scion/hummingbird/auth-server/internal/challenge"
	"github.com/scionproto/scion/hummingbird/auth-server/internal/config"
	"github.com/scionproto/scion/hummingbird/auth-server/internal/sui"
	"github.com/scionproto/scion/hummingbird/auth-server/internal/trust"
	"google.golang.org/protobuf/proto"
)

// AccountServiceRegisterASProcedure is the Connect RPC procedure the AS client
// includes as associated data when signing the challenge.
const AccountServiceRegisterASProcedure = "/proto.hummingbird.v1.AccountService/RegisterAS"

// Handler implements ASRegistrationServiceHandler.
type Handler struct {
	hummingbirdconnect.UnimplementedASRegistrationServiceHandler
	cfg        *config.Config
	challenges *challenge.Store
	sui        *sui.Client
	certs      *trust.CertPool
}

func New(cfg *config.Config, challenges *challenge.Store, suiClient *sui.Client, certs *trust.CertPool) *Handler {
	return &Handler{cfg: cfg, challenges: challenges, sui: suiClient, certs: certs}
}

func (h *Handler) CreateChallenge(
	_ context.Context,
	req *connect.Request[v1.CreateChallengeRequest],
) (*connect.Response[v1.CreateChallengeResponse], error) {

	if req.Msg.SuiAddress == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("sui_address is required"))
	}

	id, nonce, err := h.challenges.Create(req.Msg.Ia, req.Msg.SuiAddress)

	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&v1.CreateChallengeResponse{
		Id:    id,
		Value: nonce,
	}), nil
}

func (h *Handler) RegisterAS(
	_ context.Context,
	req *connect.Request[v1.RegisterASRequest],
) (*connect.Response[v1.RegisterASResponse], error) {
	sm := req.Msg.SignedChallenge

	if sm == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("signed_challenge is required"))
	}

	// --- 1. Unpack the SignedMessage structure ---
	// header_and_body is a serialized HeaderAndBodyInternal { header: bytes, body: bytes }
	hab := &cryptopb.HeaderAndBodyInternal{}
	if err := proto.Unmarshal(sm.HeaderAndBody, hab); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("decode header_and_body: %w", err))
	}

	hdr := &cryptopb.Header{}
	if err := proto.Unmarshal(hab.Header, hdr); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("decode header: %w", err))
	}

	// --- 2. Parse VerificationKeyID to get the Subject Key ID and ISD-AS ---
	// Header.verification_key_id is a serialized proto.control_plane.v1.VerificationKeyID,
	// NOT the raw public key bytes.
	var keyID cppb.VerificationKeyID
	if err := proto.Unmarshal(hdr.VerificationKeyId, &keyID); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("decode verification_key_id: %w", err))
	}
	
	// --- 3. Consume the challenge (validates ID and extracts nonce + ISD-AS) ---
	entry := h.challenges.Consume(req.Msg.Id)
	if entry == nil {
		return nil, connect.NewError(connect.CodeNotFound,
			fmt.Errorf("challenge not found or expired"))
	}

	// Verify the ISD-AS in the signed key ID matches the challenge.
	if keyID.IsdAs != entry.IsdAsID {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("ISD-AS mismatch: challenge for %d, signature from %d",
				entry.IsdAsID, keyID.IsdAs))
	}

	// --- 4. Verify the signed body is the nonce ---
	// hab.Body is the raw payload signed by the AS; it must equal the challenge nonce.
	if string(hab.Body) != string(entry.Nonce) {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("signed body does not match challenge nonce"))
	}

	// --- 5. Look up the trusted ECDSA certificate by SubjectKeyId ---
	cert := h.certs.GetBySkid(keyID.SubjectKeyId)
	if cert == nil {
		return nil, connect.NewError(connect.CodeUnauthenticated,
			fmt.Errorf("no trusted certificate for subject key ID %x (ISD-AS %d)",
				keyID.SubjectKeyId, keyID.IsdAs))
	}
	fmt.Println(cert);
	ecdsaPub, ok := cert.PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return nil, connect.NewError(connect.CodeInternal,
			fmt.Errorf("certificate public key is not ECDSA"))
	}

	// --- 6. Verify the ECDSA-SHA256 signature ---
	// SCION signs: SHA256(header_and_body || authority || procedure_name)
	// associated_data order matches client.go: [authority, procedure]
	h256 := sha256.New()
	h256.Write(sm.HeaderAndBody)
	h256.Write([]byte(req.Msg.Authority))
	h256.Write([]byte(AccountServiceRegisterASProcedure))
	digest := h256.Sum(nil)

	if !ecdsa.VerifyASN1(ecdsaPub, digest, sm.Signature) {
		return nil, connect.NewError(connect.CodeUnauthenticated,
			fmt.Errorf("ECDSA signature verification failed"))
	}

	// --- 7. On-chain registration ---
	asAuthCapID, err := h.sui.RegisterAsFor(
		h.cfg.Sui.PackageID,
		h.cfg.Sui.GlobalRegistryID,
		h.cfg.Sui.MarketAdminCapID,
		entry.IsdAsID,
		entry.SuiAddress,
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal,
			fmt.Errorf("on-chain registration failed: %w", err))
	}
	fmt.Println("New AsAuthCap created at ", asAuthCapID);

	return connect.NewResponse(&v1.RegisterASResponse{AuthCapId: asAuthCapID}), nil
}
