package challenge

import (
	"crypto/rand"
	"fmt"
	"sync"
	"time"
)

// Entry holds the data bound to a pending challenge.
type Entry struct {
	Nonce      []byte
	IsdAsID    uint64
	SuiAddress string
	ExpiresAt  time.Time
}

// Store is a thread-safe in-memory map of challenge ID → Entry with TTL eviction.
type Store struct {
	mu      sync.Mutex
	entries map[string]*Entry
	ttl     time.Duration
}

func New(ttl time.Duration) *Store {
	s := &Store{
		entries: make(map[string]*Entry),
		ttl:     ttl,
	}
	go s.evict()
	return s
}

// Create generates a new 32-byte nonce, stores the entry under a random ID, and
// returns (id, nonce).
func (s *Store) Create(isdAsID uint64, suiAddress string) (string, []byte, error) {
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return "", nil, fmt.Errorf("generate challenge id: %w", err)
	}
	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return "", nil, fmt.Errorf("generate nonce: %w", err)
	}
	idStr := fmt.Sprintf("%x", id)

	s.mu.Lock()
	s.entries[idStr] = &Entry{
		Nonce:      nonce,
		IsdAsID:    isdAsID,
		SuiAddress: suiAddress,
		ExpiresAt:  time.Now().Add(s.ttl),
	}
	s.mu.Unlock()
	return idStr, nonce, nil
}

// Consume retrieves and deletes an entry by ID. Returns nil if not found or expired.
func (s *Store) Consume(id string) *Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[id]
	if !ok || time.Now().After(e.ExpiresAt) {
		delete(s.entries, id)
		return nil
	}
	delete(s.entries, id)
	return e
}

func (s *Store) evict() {
	ticker := time.NewTicker(time.Minute)
	for range ticker.C {
		now := time.Now()
		s.mu.Lock()
		for id, e := range s.entries {
			if now.After(e.ExpiresAt) {
				delete(s.entries, id)
			}
		}
		s.mu.Unlock()
	}
}
