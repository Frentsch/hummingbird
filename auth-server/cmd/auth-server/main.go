package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"connectrpc.com/connect"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"

	"github.com/scionproto/scion/hummingbird/auth-server/gen/hummingbird/v1/hummingbirdconnect"
	"github.com/scionproto/scion/hummingbird/auth-server/internal/challenge"
	"github.com/scionproto/scion/hummingbird/auth-server/internal/config"
	"github.com/scionproto/scion/hummingbird/auth-server/internal/server"
	"github.com/scionproto/scion/hummingbird/auth-server/internal/sui"
	"github.com/scionproto/scion/hummingbird/auth-server/internal/trust"
)

func main() {
	configPath := "auth-server.json"
	if len(os.Args) > 1 {
		configPath = os.Args[1]
	}

	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	keypairs, err := sui.LoadKeypairs(cfg.Keystore.Path)
	if err != nil {
		log.Fatalf("load keystore: %v", err)
	}
	kp, err := sui.ResolveKeypair(keypairs, cfg.Keystore.Address)
	if err != nil {
		log.Fatalf("resolve signer: %v", err)
	}
	log.Printf("signer address: %s", kp.SuiAddress)

	certs, err := trust.LoadDir(cfg.TrustedCertsDir)
	if err != nil {
		log.Fatalf("load trusted certs: %v", err)
	}

	suiClient := sui.NewClient(cfg.Sui.RPCURL, kp, cfg.Sui.GasBudget)
	store := challenge.New(time.Duration(cfg.Challenge.TTLS) * time.Second)
	handler := server.New(cfg, store, suiClient, certs)

	path, h := hummingbirdconnect.NewASRegistrationServiceHandler(
		handler,
		connect.WithInterceptors(),
	)
	mux := http.NewServeMux()
	mux.Handle(path, h)

	addr := fmt.Sprintf(":%d", cfg.GRPC.Port)
	log.Printf("auth-server listening on %s", addr)
	if err := http.ListenAndServe(addr, h2c.NewHandler(mux, &http2.Server{})); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
