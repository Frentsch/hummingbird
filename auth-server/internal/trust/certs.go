package trust

import (
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
)

// CertPool indexes trusted AS X.509 certificates by their SubjectKeyId.
// Each AS that wants to register must have its certificate present in the
// configured trusted-certs directory.
type CertPool struct {
	// bySkid maps hex(SubjectKeyId) → certificate.
	bySkid map[string]*x509.Certificate
}

// LoadDir reads all *.pem files from dir, parses every certificate block
// found inside, and indexes them by SubjectKeyId.
func LoadDir(dir string) (*CertPool, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read trusted-certs dir %s: %w", dir, err)
	}
	pool := &CertPool{bySkid: make(map[string]*x509.Certificate)}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		path := filepath.Join(dir, e.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", path, err)
		}
		for len(data) > 0 {
			var block *pem.Block
			block, data = pem.Decode(data)
			if block == nil {
				break
			}
			if block.Type != "CERTIFICATE" {
				continue
			}
			cert, err := x509.ParseCertificate(block.Bytes)
			if err != nil {
				return nil, fmt.Errorf("parse cert in %s: %w", path, err)
			}
			key := fmt.Sprintf("%x", cert.SubjectKeyId)
			pool.bySkid[key] = cert
		}
	}
	return pool, nil
}

// GetBySkid returns the certificate with the given SubjectKeyId, or nil if not found.
func (p *CertPool) GetBySkid(skid []byte) *x509.Certificate {
	return p.bySkid[fmt.Sprintf("%x", skid)]
}
