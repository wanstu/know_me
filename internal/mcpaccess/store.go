package mcpaccess

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

type Token struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Scope      string `json:"scope"`
	CreatedAt  int64  `json:"createdAt"`
	LastUsedAt *int64 `json:"lastUsedAt"`
}
type Store struct{ db *sql.DB }

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

func (s *Store) Create(ctx context.Context, name, scope string) (Token, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return Token{}, "", errors.New("invalid_name")
	}
	if scope != "read" && scope != "write" {
		return Token{}, "", errors.New("invalid_scope")
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return Token{}, "", err
	}
	secret := "km_" + hex.EncodeToString(buf)
	sum := sha256.Sum256([]byte(secret))
	idBytes := make([]byte, 16)
	if _, err := rand.Read(idBytes); err != nil {
		return Token{}, "", err
	}
	token := Token{ID: hex.EncodeToString(idBytes), Name: name, Scope: scope, CreatedAt: time.Now().UnixMilli()}
	_, err := s.db.ExecContext(ctx, "INSERT INTO mcp_tokens(id,name,secret_hash,scope,created_at) VALUES(?,?,?,?,?)", token.ID, token.Name, hex.EncodeToString(sum[:]), scope, token.CreatedAt)
	if err != nil {
		return Token{}, "", err
	}
	return token, secret, nil
}
func (s *Store) List(ctx context.Context) ([]Token, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,name,scope,created_at,last_used_at FROM mcp_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Token{}
	for rows.Next() {
		var t Token
		var last sql.NullInt64
		if err := rows.Scan(&t.ID, &t.Name, &t.Scope, &t.CreatedAt, &last); err != nil {
			return nil, err
		}
		if last.Valid {
			v := last.Int64
			t.LastUsedAt = &v
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
func (s *Store) Resolve(ctx context.Context, secret string) (Token, error) {
	if !strings.HasPrefix(secret, "km_") || len(secret) != 67 {
		return Token{}, errors.New("invalid_token")
	}
	sum := sha256.Sum256([]byte(secret))
	var t Token
	err := s.db.QueryRowContext(ctx, "SELECT id,name,scope,created_at FROM mcp_tokens WHERE secret_hash=? AND revoked_at IS NULL", hex.EncodeToString(sum[:])).Scan(&t.ID, &t.Name, &t.Scope, &t.CreatedAt)
	if err != nil {
		return Token{}, errors.New("invalid_token")
	}
	// Last use tracking must not prevent an otherwise valid call.
	_, _ = s.db.ExecContext(ctx, "UPDATE mcp_tokens SET last_used_at=? WHERE id=?", time.Now().UnixMilli(), t.ID)
	return t, nil
}
func (s *Store) Revoke(ctx context.Context, id string) (bool, error) {
	res, err := s.db.ExecContext(ctx, "UPDATE mcp_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL", time.Now().UnixMilli(), id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}
