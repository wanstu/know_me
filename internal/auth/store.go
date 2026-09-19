package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

const (
	SessionCookie = "know_me_session"
	SessionTTL    = 30 * 24 * time.Hour
)

type User struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar"`
}

type Credentials struct {
	UserID       int64
	PasswordHash string
}

type Session struct {
	Token     string
	ExpiresAt time.Time
}

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) CredentialsByUsername(ctx context.Context, username string) (Credentials, bool, error) {
	var value Credentials
	err := s.db.QueryRowContext(ctx,
		"SELECT id, password_hash FROM users WHERE username = ? LIMIT 1",
		strings.TrimSpace(username),
	).Scan(&value.UserID, &value.PasswordHash)
	if err == sql.ErrNoRows {
		return Credentials{}, false, nil
	}
	if err != nil {
		return Credentials{}, false, err
	}
	return value, true, nil
}

func (s *Store) UpsertAdmin(ctx context.Context, username, password, displayName string) (created bool, err error) {
	username = strings.TrimSpace(username)
	displayName = strings.TrimSpace(displayName)
	if username == "" {
		return false, fmt.Errorf("username_required")
	}
	if displayName == "" {
		displayName = username
	}
	hash, err := HashPassword(password)
	if err != nil {
		return false, err
	}
	now := time.Now().UnixMilli()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	var id int64
	err = tx.QueryRowContext(ctx, "SELECT id FROM users WHERE username = ? LIMIT 1", username).Scan(&id)
	switch {
	case err == sql.ErrNoRows:
		result, execErr := tx.ExecContext(ctx,
			"INSERT INTO users (username, password_hash, display_name, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
			username, hash, displayName, "", now, now,
		)
		if execErr != nil {
			return false, execErr
		}
		id, err = result.LastInsertId()
		if err != nil {
			return false, err
		}
		created = true
	case err != nil:
		return false, err
	default:
		if _, err := tx.ExecContext(ctx,
			"UPDATE users SET password_hash = ?, display_name = ?, updated_at = ? WHERE id = ?",
			hash, displayName, now, id,
		); err != nil {
			return false, err
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ?", id); err != nil {
			return false, err
		}
	}

	if err := tx.Commit(); err != nil {
		return false, err
	}
	return created, nil
}

func (s *Store) CleanupExpired(ctx context.Context, now time.Time) (int64, error) {
	result, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at <= ?", now.UnixMilli())
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (s *Store) CreateSession(ctx context.Context, userID int64, userAgent string) (Session, error) {
	if _, err := s.CleanupExpired(ctx, time.Now()); err != nil {
		return Session{}, err
	}
	token, err := randomToken(32)
	if err != nil {
		return Session{}, err
	}
	id, err := randomToken(18)
	if err != nil {
		return Session{}, err
	}
	now := time.Now()
	expiresAt := now.Add(SessionTTL)
	_, err = s.db.ExecContext(ctx,
		"INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at, user_agent_hint) VALUES (?, ?, ?, ?, ?, ?, ?)",
		id, userID, hashToken(token), expiresAt.UnixMilli(), now.UnixMilli(), now.UnixMilli(), truncate(userAgent, 240),
	)
	if err != nil {
		return Session{}, err
	}
	return Session{Token: token, ExpiresAt: expiresAt}, nil
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	if strings.TrimSpace(token) == "" {
		return nil
	}
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash = ?", hashToken(token))
	return err
}

func (s *Store) UserForSession(ctx context.Context, token string) (*User, error) {
	if token == "" {
		return nil, nil
	}
	now := time.Now()
	var user User
	var lastSeen int64
	err := s.db.QueryRowContext(ctx,
		"SELECT users.id, users.username, users.display_name, users.avatar, sessions.last_seen_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? LIMIT 1",
		hashToken(token), now.UnixMilli(),
	).Scan(&user.ID, &user.Username, &user.DisplayName, &user.Avatar, &lastSeen)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if now.UnixMilli()-lastSeen > int64(5*time.Minute/time.Millisecond) {
		_, _ = s.db.ExecContext(ctx, "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", now.UnixMilli(), hashToken(token))
	}
	return &user, nil
}

func randomToken(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}
