package sui

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"

	"golang.org/x/crypto/blake2b"
)

// pubKeyToSuiAddress derives the Sui address from an Ed25519 public key.
// Sui address = "0x" + hex(blake2b256(flag || pubkey))
func pubKeyToSuiAddress(flag byte, pub ed25519.PublicKey) string {
	h, _ := blake2b.New256(nil)
	h.Write([]byte{flag})
	h.Write(pub)
	return "0x" + hex.EncodeToString(h.Sum(nil))
}

// SignForSui signs transaction bytes and returns the base64-encoded Sui signature:
// flag(1) || ed25519_sig(64) || pubkey(32)
func SignForSui(kp *Keypair, txBytes []byte) string {
	// Sui intent prefix: IntentScope::TransactionData, IntentVersion::V0, AppId::Sui
	intent := []byte{0, 0, 0}
	msg := append(intent, txBytes...)
	h, _ := blake2b.New256(nil)
	h.Write(msg)
	sig := ed25519.Sign(kp.PrivKey, h.Sum(nil))

	out := make([]byte, 1+64+32)
	out[0] = flagEd25519
	copy(out[1:], sig)
	copy(out[65:], kp.PubKey)
	return base64.StdEncoding.EncodeToString(out)
}
