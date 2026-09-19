package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/scrypt"
)

const (
	passwordSaltBytes = 16
	passwordKeyBytes  = 64
	scryptN           = 1 << 14
	scryptR           = 8
	scryptP           = 1
)

func HashPassword(password string) (string, error) {
	if len(password) < 10 {
		return "", fmt.Errorf("password_too_short")
	}
	salt := make([]byte, passwordSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("password salt: %w", err)
	}
	key, err := scrypt.Key([]byte(password), salt, scryptN, scryptR, scryptP, passwordKeyBytes)
	if err != nil {
		return "", fmt.Errorf("scrypt: %w", err)
	}
	return "scrypt$" + base64.RawURLEncoding.EncodeToString(salt) + "$" + base64.RawURLEncoding.EncodeToString(key), nil
}

func GeneratePassword() (string, error) {
	data := make([]byte, 18)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func VerifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 3 || parts[0] != "scrypt" {
		return false
	}
	salt, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	expected, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(expected) == 0 {
		return false
	}
	actual, err := scrypt.Key([]byte(password), salt, scryptN, scryptR, scryptP, len(expected))
	if err != nil || len(actual) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
