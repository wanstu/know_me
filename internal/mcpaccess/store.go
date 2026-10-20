package mcpaccess

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"
)

const (
	PermissionPostsRead       = "posts.read"
	PermissionPostsWrite      = "posts.write"
	PermissionTaxonomyRead    = "taxonomy.read"
	PermissionTaxonomyWrite   = "taxonomy.write"
	PermissionSiteRead        = "site.read"
	PermissionSiteWrite       = "site.write"
	PermissionStartRead       = "start.read"
	PermissionStartWrite      = "start.write"
	PermissionNavigationRead  = "navigation.read"
	PermissionNavigationWrite = "navigation.write"
	PermissionMediaWrite      = "media.write"
)

var PermissionCatalog = []string{
	PermissionPostsRead,
	PermissionPostsWrite,
	PermissionTaxonomyRead,
	PermissionTaxonomyWrite,
	PermissionSiteRead,
	PermissionSiteWrite,
	PermissionStartRead,
	PermissionStartWrite,
	PermissionNavigationRead,
	PermissionNavigationWrite,
	PermissionMediaWrite,
}

var permissionSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(PermissionCatalog))
	for _, permission := range PermissionCatalog {
		out[permission] = struct{}{}
	}
	return out
}()

type Token struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Scope          string   `json:"scope"`
	Permissions    []string `json:"permissions,omitempty"`
	PermissionMode string   `json:"permissionMode"`
	CreatedAt      int64    `json:"createdAt"`
	LastUsedAt     *int64   `json:"lastUsedAt"`
}

type Store struct{ db *sql.DB }

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

func NormalizePermissions(input []string) ([]string, error) {
	selected := make(map[string]struct{}, len(input)+5)
	for _, raw := range input {
		permission := strings.TrimSpace(raw)
		if _, ok := permissionSet[permission]; !ok {
			return nil, errors.New("invalid_permission")
		}
		selected[permission] = struct{}{}
	}
	if len(selected) == 0 {
		return nil, errors.New("permissions_required")
	}
	for _, pair := range [][2]string{
		{PermissionPostsWrite, PermissionPostsRead},
		{PermissionTaxonomyWrite, PermissionTaxonomyRead},
		{PermissionSiteWrite, PermissionSiteRead},
		{PermissionStartWrite, PermissionStartRead},
		{PermissionNavigationWrite, PermissionNavigationRead},
	} {
		if _, ok := selected[pair[0]]; ok {
			selected[pair[1]] = struct{}{}
		}
	}
	out := make([]string, 0, len(selected))
	for permission := range selected {
		out = append(out, permission)
	}
	sort.Strings(out)
	return out, nil
}

func legacyPermissions(scope string) []string {
	read := []string{
		PermissionNavigationRead,
		PermissionPostsRead,
		PermissionSiteRead,
		PermissionStartRead,
		PermissionTaxonomyRead,
	}
	if scope != "write" {
		return read
	}
	out := append([]string{}, read...)
	out = append(out,
		PermissionMediaWrite,
		PermissionNavigationWrite,
		PermissionPostsWrite,
		PermissionSiteWrite,
		PermissionStartWrite,
		PermissionTaxonomyWrite,
	)
	sort.Strings(out)
	return out
}

func (t Token) EffectivePermissions() []string {
	if t.PermissionMode == "custom" {
		return append([]string{}, t.Permissions...)
	}
	return legacyPermissions(t.Scope)
}

func (t Token) HasPermission(permission string) bool {
	for _, granted := range t.EffectivePermissions() {
		if granted == permission {
			return true
		}
	}
	return false
}

func (t Token) PermissionKey() string {
	return strings.Join(t.EffectivePermissions(), ",")
}

func validateName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return "", errors.New("invalid_name")
	}
	return name, nil
}

func issueSecret() (id, secret, hash string, err error) {
	buf := make([]byte, 32)
	if _, err = rand.Read(buf); err != nil {
		return "", "", "", err
	}
	secret = "km_" + hex.EncodeToString(buf)
	sum := sha256.Sum256([]byte(secret))
	idBytes := make([]byte, 16)
	if _, err = rand.Read(idBytes); err != nil {
		return "", "", "", err
	}
	return hex.EncodeToString(idBytes), secret, hex.EncodeToString(sum[:]), nil
}

func (s *Store) Create(ctx context.Context, name, scope string) (Token, string, error) {
	name, err := validateName(name)
	if err != nil {
		return Token{}, "", err
	}
	if scope != "read" && scope != "write" {
		return Token{}, "", errors.New("invalid_scope")
	}
	id, secret, hash, err := issueSecret()
	if err != nil {
		return Token{}, "", err
	}
	token := Token{ID: id, Name: name, Scope: scope, PermissionMode: "legacy", CreatedAt: time.Now().UnixMilli()}
	_, err = s.db.ExecContext(ctx, "INSERT INTO mcp_tokens(id,name,secret_hash,scope,permissions,created_at) VALUES(?,?,?,?,NULL,?)",
		token.ID, token.Name, hash, scope, token.CreatedAt)
	if err != nil {
		return Token{}, "", err
	}
	return token, secret, nil
}

func scopeForPermissions(permissions []string) string {
	for _, permission := range permissions {
		if strings.HasSuffix(permission, ".write") {
			return "write"
		}
	}
	return "read"
}

func (s *Store) CreateWithPermissions(ctx context.Context, name string, permissions []string) (Token, string, error) {
	name, err := validateName(name)
	if err != nil {
		return Token{}, "", err
	}
	permissions, err = NormalizePermissions(permissions)
	if err != nil {
		return Token{}, "", err
	}
	id, secret, hash, err := issueSecret()
	if err != nil {
		return Token{}, "", err
	}
	encoded, err := json.Marshal(permissions)
	if err != nil {
		return Token{}, "", err
	}
	token := Token{
		ID: id, Name: name, Scope: scopeForPermissions(permissions),
		Permissions: permissions, PermissionMode: "custom", CreatedAt: time.Now().UnixMilli(),
	}
	_, err = s.db.ExecContext(ctx, "INSERT INTO mcp_tokens(id,name,secret_hash,scope,permissions,created_at) VALUES(?,?,?,?,?,?)",
		token.ID, token.Name, hash, token.Scope, string(encoded), token.CreatedAt)
	if err != nil {
		return Token{}, "", err
	}
	return token, secret, nil
}

func scanToken(scanner interface{ Scan(...any) error }) (Token, error) {
	var t Token
	var last sql.NullInt64
	var permissions sql.NullString
	if err := scanner.Scan(&t.ID, &t.Name, &t.Scope, &permissions, &t.CreatedAt, &last); err != nil {
		return Token{}, err
	}
	if last.Valid {
		v := last.Int64
		t.LastUsedAt = &v
	}
	if !permissions.Valid {
		t.PermissionMode = "legacy"
		return t, nil
	}
	if err := json.Unmarshal([]byte(permissions.String), &t.Permissions); err != nil {
		return Token{}, err
	}
	normalized, err := NormalizePermissions(t.Permissions)
	if err != nil {
		return Token{}, err
	}
	t.Permissions = normalized
	t.PermissionMode = "custom"
	return t, nil
}

func (s *Store) List(ctx context.Context) ([]Token, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,name,scope,permissions,created_at,last_used_at FROM mcp_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Token{}
	for rows.Next() {
		t, err := scanToken(rows)
		if err != nil {
			return nil, err
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
	row := s.db.QueryRowContext(ctx,
		"SELECT id,name,scope,permissions,created_at,last_used_at FROM mcp_tokens WHERE secret_hash=? AND revoked_at IS NULL",
		hex.EncodeToString(sum[:]))
	t, err := scanToken(row)
	if err != nil {
		return Token{}, errors.New("invalid_token")
	}
	_, _ = s.db.ExecContext(ctx, "UPDATE mcp_tokens SET last_used_at=? WHERE id=?", time.Now().UnixMilli(), t.ID)
	return t, nil
}

func (s *Store) UpdatePermissions(ctx context.Context, id string, permissions []string) (Token, bool, error) {
	id = strings.TrimSpace(id)
	permissions, err := NormalizePermissions(permissions)
	if err != nil {
		return Token{}, false, err
	}
	encoded, err := json.Marshal(permissions)
	if err != nil {
		return Token{}, false, err
	}
	scope := scopeForPermissions(permissions)
	res, err := s.db.ExecContext(ctx,
		"UPDATE mcp_tokens SET scope=?,permissions=? WHERE id=? AND revoked_at IS NULL",
		scope, string(encoded), id)
	if err != nil {
		return Token{}, false, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return Token{}, false, nil
	}
	row := s.db.QueryRowContext(ctx,
		"SELECT id,name,scope,permissions,created_at,last_used_at FROM mcp_tokens WHERE id=? AND revoked_at IS NULL", id)
	t, err := scanToken(row)
	if err != nil {
		return Token{}, false, err
	}
	return t, true, nil
}

func (s *Store) Revoke(ctx context.Context, id string) (bool, error) {
	res, err := s.db.ExecContext(ctx, "UPDATE mcp_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL", time.Now().UnixMilli(), id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}
