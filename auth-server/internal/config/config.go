package config

import (
	"encoding/json"
	"fmt"
	"os"
)

type Config struct {
	GRPC           GRPCConfig      `json:"grpc"`
	Keystore       KeystoreConfig  `json:"keystore"`
	Sui            SuiConfig       `json:"sui"`
	Challenge      ChallengeConfig `json:"challenge"`
	// Directory containing trusted AS X.509 certificates (PEM files).
	// Each registered AS must have its ECDSA certificate present here.
	TrustedCertsDir string `json:"trustedCertsDir"`
}

type GRPCConfig struct {
	Port int `json:"port"`
}

type KeystoreConfig struct {
	// Path to the Sui keystore file (JSON array of base64-encoded keys).
	Path string `json:"path"`
	// Sui address of the signer (optional; first key in the keystore is used if omitted).
	Address string `json:"address,omitempty"`
}

type SuiConfig struct {
	// Sui fullnode gRPC target (host:port), e.g. fullnode.testnet.sui.io:443
	RPCURL string `json:"rpcUrl"`
	// Package ID of the deployed hummingbird Move package.
	PackageID string `json:"packageId"`
	// Object ID of the GlobalRegistry shared object.
	GlobalRegistryID string `json:"globalRegistryId"`
	// Object ID of the MarketAdminCap owned by the auth server's wallet.
	MarketAdminCapID string `json:"marketAdminCapId"`
	// Gas budget per transaction (in MIST).
	GasBudget uint64 `json:"gasBudget"`
}

type ChallengeConfig struct {
	// How long (in seconds) a challenge stays valid before expiring.
	TTLS int `json:"ttlSecs"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}
	if cfg.GRPC.Port == 0 {
		cfg.GRPC.Port = 9092
	}
	if cfg.Sui.GasBudget == 0 {
		cfg.Sui.GasBudget = 50_000_000
	}
	if cfg.Challenge.TTLS == 0 {
		cfg.Challenge.TTLS = 300
	}
	return &cfg, nil
}
