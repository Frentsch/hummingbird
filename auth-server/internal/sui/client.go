package sui

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync/atomic"
)

// Client wraps the Sui JSON-RPC endpoint and a signing keypair.
type Client struct {
	rpcURL    string
	kp        *Keypair
	gasBudget uint64
	idCounter atomic.Uint64
	http      *http.Client
}

func NewClient(rpcURL string, kp *Keypair, gasBudget uint64) *Client {
	return &Client{
		rpcURL:    rpcURL,
		kp:        kp,
		gasBudget: gasBudget,
		http:      &http.Client{},
	}
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      uint64 `json:"id"`
	Method  string `json:"method"`
	Params  []any  `json:"params"`
}

type rpcResponse[T any] struct {
	JSONRPC string   `json:"jsonrpc"`
	ID      uint64   `json:"id"`
	Result  T        `json:"result"`
	Error   *rpcError `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (c *Client) call(method string, params []any, result any) error {
	id := c.idCounter.Add(1)
	body, err := json.Marshal(rpcRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	})
	if err != nil {
		return err
	}
	resp, err := c.http.Post(c.rpcURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("rpc %s: %w", method, err)
	}
	defer resp.Body.Close()

	var raw rpcResponse[json.RawMessage]
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return fmt.Errorf("decode rpc response: %w", err)
	}
	if raw.Error != nil {
		return fmt.Errorf("rpc %s error %d: %s", method, raw.Error.Code, raw.Error.Message)
	}
	return json.Unmarshal(raw.Result, result)
}

type txBlockBytes struct {
	TxBytes string `json:"txBytes"`
}

type objectChange struct {
	Type       string `json:"type"`
	ObjectType string `json:"objectType"`
	ObjectID   string `json:"objectId"`
}

type txResponse struct {
	ObjectChanges []objectChange `json:"objectChanges"`
}

// RegisterAsFor builds, signs, and executes registry::register_as_for on-chain.
// Returns the object ID of the created AsAuthCap on success.
func (c *Client) RegisterAsFor(packageID, globalRegistryID, marketAdminCapID string, isdAsID uint64, recipient string) (string, error) {
	fmt.Println(c.kp.SuiAddress)
	var built txBlockBytes
	err := c.call("unsafe_moveCall", []any{
		c.kp.SuiAddress,
		packageID,
		"registry",
		"register_as_for",
		[]string{}, // no type args
		[]any{
			marketAdminCapID,
			globalRegistryID,
			strconv.FormatUint(isdAsID, 10),
			recipient,
		},
		nil, // gas object (auto-select)
		strconv.FormatUint(c.gasBudget, 10),
	}, &built)
	if err != nil {
		return "", fmt.Errorf("build transaction: %w", err)
	}

	txBytes, err := base64.StdEncoding.DecodeString(built.TxBytes)
	if err != nil {
		return "", fmt.Errorf("decode txBytes: %w", err)
	}

	sig := SignForSui(c.kp, txBytes)

	var execResult txResponse
	err = c.call("sui_executeTransactionBlock", []any{
		built.TxBytes,
		[]string{sig},
		map[string]bool{"showObjectChanges": true},
		"WaitForLocalExecution",
	}, &execResult)
	if err != nil {
		return "", fmt.Errorf("execute transaction: %w", err)
	}

	suffix := packageID + "::registry::AsAuthCap"
	for _, ch := range execResult.ObjectChanges {
		if ch.Type == "created" && len(ch.ObjectType) >= len(suffix) &&
			ch.ObjectType[len(ch.ObjectType)-len(suffix):] == suffix {
				fmt.Println(ch.ObjectID);
			return ch.ObjectID, nil
		}
	}
	return "", fmt.Errorf("AsAuthCap not found in transaction object changes")
}
