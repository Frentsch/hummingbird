package sui

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

const (
	flagEd25519   = byte(0)
	flagSecp256k1 = byte(1)
	flagSecp256r1 = byte(2)
)

type Keypair struct {
	PrivKey    ed25519.PrivateKey
	PubKey     ed25519.PublicKey
	SuiAddress string
}

// LoadKeypairs reads a Sui keystore file and returns all Ed25519 keypairs.
func LoadKeypairs(path string) ([]*Keypair, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read keystore %s: %w", path, err)
	}
	var entries []string
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, fmt.Errorf("parse keystore: %w", err)
	}

	var kps []*Keypair
	for _, entry := range entries {
		raw, err := base64.StdEncoding.DecodeString(entry)
		if err != nil {
			return nil, fmt.Errorf("decode keystore entry: %w", err)
		}
		if raw[0] != flagEd25519 {
			continue // skip non-Ed25519 keys
		}
		var seed []byte
		switch len(raw) {
		case 33: // flag(1) + seed(32)
			seed = raw[1:33]
		case 65: // flag(1) + pubkey(32) + seed(32)
			seed = raw[33:65]
		default:
			return nil, fmt.Errorf("unexpected keystore entry length %d", len(raw))
		}
		priv := ed25519.NewKeyFromSeed(seed)
		pub := priv.Public().(ed25519.PublicKey)
		kps = append(kps, &Keypair{
			PrivKey:    priv,
			PubKey:     pub,
			SuiAddress: pubKeyToSuiAddress(flagEd25519, pub),
		})
	}
	if len(kps) == 0 {
		return nil, fmt.Errorf("no Ed25519 keys found in keystore")
	}
	return kps, nil
}

// ResolveKeypair returns the keypair matching address, or the first one if address is empty.
func ResolveKeypair(kps []*Keypair, address string) (*Keypair, error) {
	if address == "" {
		return kps[0], nil
	}
	norm := strings.ToLower(address)
	for _, kp := range kps {
		if strings.ToLower(kp.SuiAddress) == norm {
			return kp, nil
		}
	}
	return nil, fmt.Errorf("address %s not found in keystore", address)
}
