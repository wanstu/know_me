package media

import (
	"bytes"
	"context"
	"encoding/binary"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/database"
)

func makeWebPChunk(kind string, payload []byte) []byte {
	size := 12 + 8 + len(payload)
	if len(payload)%2 != 0 {
		size++
	}
	data := make([]byte, size)
	copy(data[0:4], "RIFF")
	binary.LittleEndian.PutUint32(data[4:8], uint32(size-8))
	copy(data[8:12], "WEBP")
	copy(data[12:16], kind)
	binary.LittleEndian.PutUint32(data[16:20], uint32(len(payload)))
	copy(data[20:], payload)
	return data
}

func TestWebPDimensions(t *testing.T) {
	t.Parallel()

	vp8x := []byte{0, 0, 0, 0, 0x7f, 0x02, 0x00, 0x67, 0x01, 0x00}
	vp8lBits := uint32(639) | uint32(359)<<14
	vp8l := make([]byte, 5)
	vp8l[0] = 0x2f
	binary.LittleEndian.PutUint32(vp8l[1:], vp8lBits)
	vp8 := []byte{0, 0, 0, 0x9d, 0x01, 0x2a, 0x80, 0x02, 0x68, 0x01}

	for name, data := range map[string][]byte{
		"VP8X": makeWebPChunk("VP8X", vp8x),
		"VP8L": makeWebPChunk("VP8L", vp8l),
		"VP8":  makeWebPChunk("VP8 ", vp8),
	} {
		width, height := imageDimensions(data, "image/webp")
		if width != 640 || height != 360 {
			t.Fatalf("%s dimensions=%dx%d", name, width, height)
		}
	}

	if width, height := imageDimensions([]byte("not-webp"), "image/webp"); width != 0 || height != 0 {
		t.Fatalf("invalid webp dimensions=%dx%d", width, height)
	}
}

func TestMediaLifecycle(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	db, err := database.Open(filepath.Join(root, "media.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store, err := NewStore(db.SQL, filepath.Join(root, "uploads"))
	if err != nil {
		t.Fatal(err)
	}

	imageData := image.NewRGBA(image.Rect(0, 0, 2, 3))
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, imageData); err != nil {
		t.Fatal(err)
	}
	item, err := store.Save(context.Background(), "smoke.png", "image/png", encoded.Bytes(), "smoke")
	if err != nil {
		t.Fatal(err)
	}
	if item.URL == "" || item.StorageKey == "" {
		t.Fatalf("item=%#v", item)
	}
	if item.Width != 2 || item.Height != 3 {
		t.Fatalf("dimensions=%dx%d", item.Width, item.Height)
	}
	path, err := store.FilePath(item.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}

	items, err := store.List(context.Background(), 20)
	if err != nil || len(items) != 1 {
		t.Fatalf("list=%d err=%v", len(items), err)
	}

	updated, err := store.UpdateAlt(context.Background(), item.ID, "updated alt")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Alt != "updated alt" {
		t.Fatalf("updated alt=%q", updated.Alt)
	}

	deleted, err := store.Delete(context.Background(), item.ID)
	if err != nil || !deleted {
		t.Fatalf("delete=%v err=%v", deleted, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("file still exists: %v", err)
	}

	if _, err := store.FilePath("../escape.png"); err == nil {
		t.Fatal("path traversal accepted")
	}
	if _, err := store.Save(context.Background(), "fake.png", "image/png", []byte("not an image"), "fake"); err == nil || err.Error() != "invalid_media_file" {
		t.Fatalf("expected invalid_media_file, got %v", err)
	}
	if _, err := store.Save(context.Background(), "wrong.jpg", "image/jpeg", encoded.Bytes(), "wrong mime"); err == nil || err.Error() != "invalid_media_file" {
		t.Fatalf("expected invalid_media_file for mismatched mime, got %v", err)
	}
}
