package blog

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/wanstu/know_me/internal/database"
)

func TestMCPBatchTaxonomyAtomicAndOptimisticLock(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "batch.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()
	one, err := store.Save(ctx, SaveInput{Title: "One", Slug: "one", ContentMD: "A", Status: StatusDraft, Tags: []string{"Old"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	two, err := store.Save(ctx, SaveInput{Title: "Two", Slug: "two", ContentMD: "B", Status: StatusDraft, Tags: []string{"Old"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	edits := []TaxonomyBatchEdit{
		{ID: one.ID, ExpectedUpdatedAt: one.UpdatedAt, Tags: []string{"New"}},
		{ID: two.ID, ExpectedUpdatedAt: two.UpdatedAt - 1, Tags: []string{"New"}},
	}
	if _, err := store.BatchUpdateTaxonomy(ctx, edits); err == nil || err.Error() != "post_modified_since_preview" {
		t.Fatalf("stale batch not rejected: %v", err)
	}
	for _, p := range []Post{one, two} {
		after, err := store.GetByID(ctx, p.ID)
		if err != nil || len(after.Tags) != 1 || after.Tags[0] != "Old" || after.UpdatedAt != p.UpdatedAt {
			t.Fatalf("partial modification: %+v err=%v", after, err)
		}
		revisions, err := store.ListRevisions(ctx, p.ID, 10)
		if err != nil || len(revisions) != 0 {
			t.Fatalf("stale batch inserted revisions: %v %+v", err, revisions)
		}
	}
	edits[1].ExpectedUpdatedAt = two.UpdatedAt
	// Deliberately fail the SECOND database update, after the first post
	// has already received its revision and relation changes.
	if _, err := db.SQL.ExecContext(ctx, "CREATE TRIGGER fail_second_post BEFORE UPDATE OF updated_at ON posts WHEN OLD.slug = 'two' BEGIN SELECT RAISE(FAIL, 'forced_failure'); END"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.BatchUpdateTaxonomy(ctx, edits); err == nil {
		t.Fatal("forced second-post failure did not abort the batch")
	}
	for _, p := range []Post{one, two} {
		after, err := store.GetByID(ctx, p.ID)
		if err != nil || after.Tags[0] != "Old" || after.UpdatedAt != p.UpdatedAt {
			t.Fatalf("failed batch not rolled back: %+v err=%v", after, err)
		}
		revs, err := store.ListRevisions(ctx, p.ID, 10)
		if err != nil || len(revs) != 0 {
			t.Fatalf("failed batch retained revision: %+v %v", revs, err)
		}
	}
	if _, err := db.SQL.ExecContext(ctx, "DROP TRIGGER fail_second_post"); err != nil {
		t.Fatal(err)
	}
	changed, err := store.BatchUpdateTaxonomy(ctx, edits)
	if err != nil || len(changed) != 2 {
		t.Fatalf("batch update: %+v %v", changed, err)
	}
	for _, p := range changed {
		if len(p.Tags) != 1 || p.Tags[0] != "New" {
			t.Fatalf("tags not updated: %+v", p)
		}
		if p.UpdatedAt <= one.UpdatedAt && p.ID == one.ID || p.UpdatedAt <= two.UpdatedAt && p.ID == two.ID {
			t.Fatalf("updatedAt did not increase: %+v", p)
		}
		revs, err := store.ListRevisions(ctx, p.ID, 5)
		if err != nil || len(revs) != 1 {
			t.Fatalf("revisions missing after batch: %+v %v", revs, err)
		}
	}
	if _, err := store.BatchUpdateTaxonomy(ctx, edits); err == nil {
		t.Fatal("stale retry did not reject")
	}
}

func TestMCPExactSlugAndVersionedSave(t *testing.T) {
	db, err := database.Open(filepath.Join(t.TempDir(), "exact.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := NewStore(db.SQL)
	ctx := context.Background()
	first, err := s.CreateWithExactSlug(ctx, SaveInput{Title: "Original", Slug: "same", ContentMD: "First"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateWithExactSlug(ctx, SaveInput{Title: "Collision", Slug: "same", ContentMD: "Second"}); err == nil || err.Error() != "slug_already_exists" {
		t.Fatalf("duplicate import expected skip: %v", err)
	}
	found, err := s.HasSlug(ctx, "same-2")
	if err != nil || found {
		t.Fatalf("import created unwanted URL suffix: %v %v", found, err)
	}
	originalVersion := first.UpdatedAt
	input := SaveInput{Title: first.Title, Slug: first.Slug, ContentMD: "Edited"}
	edited, err := s.SaveIfUnchanged(ctx, input, first.ID, &originalVersion)
	if err != nil || edited.UpdatedAt <= originalVersion {
		t.Fatalf("version edit: %+v %v", edited, err)
	}
	input.ContentMD = "Should not overwrite"
	if _, err := s.SaveIfUnchanged(ctx, input, first.ID, &originalVersion); err == nil || err.Error() != "post_modified_since_read" {
		t.Fatalf("stale write accepted: %v", err)
	}
	after, err := s.GetByID(ctx, first.ID)
	if err != nil || after.ContentMD != "Edited" {
		t.Fatalf("stale write applied: %+v %v", after, err)
	}
}
