package server

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wanstu/know_me/internal/media"
)

type mcpMediaUpload struct {
	Filename   string `json:"filename" jsonschema:"Original image file name"`
	MIME       string `json:"mime" jsonschema:"image/jpeg, image/png, image/webp or image/gif"`
	DataBase64 string `json:"dataBase64" jsonschema:"Base64-encoded image bytes without a data URL prefix"`
	Alt        string `json:"alt,omitempty"`
}

func registerMCPMediaWrite(m *mcp.Server, s *Server) {
	addMCPTool(m, "media_upload", "Upload an image into the Know Me media library from base64 bytes; does not fetch remote URLs", false, func(ctx context.Context, in mcpMediaUpload) (any, error) {
		filename := strings.TrimSpace(in.Filename)
		mime := strings.TrimSpace(in.MIME)
		if filename == "" {
			return nil, errors.New("filename_required")
		}
		if mime == "" {
			return nil, errors.New("mime_required")
		}
		encoded := strings.TrimSpace(in.DataBase64)
		if encoded == "" {
			return nil, errors.New("data_required")
		}
		// media.MaxBytes is the decoded limit. Reject obviously oversized base64
		// before allocating the decoded buffer.
		maxEncoded := ((media.MaxBytes + 2) / 3) * 4
		if len(encoded) > maxEncoded {
			return nil, errors.New("media_size_invalid")
		}
		data, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, errors.New("invalid_base64")
		}
		item, err := s.media.Save(ctx, filename, mime, data, in.Alt)
		if err != nil {
			return nil, err
		}
		return map[string]any{"media": item}, nil
	})
}
