package blog

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/wanstu/know_me/internal/database"
)

func TestBlogDraftRevisionPublishSearchSchedule(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "blog.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db.SQL)
	ctx := context.Background()

	draft, err := store.Save(ctx, SaveInput{
		Title:      "Smoke Markdown",
		Slug:       "smoke-markdown",
		ContentMD:  "# Smoke\n\nalpha_unique_term\n\n## Section\n\n- one\n- two",
		Status:     StatusDraft,
		Tags:       []string{"smoke", "markdown"},
		Categories: []string{"Test"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetPublishedBySlug(ctx, draft.Slug); err == nil {
		t.Fatal("draft leaked into public lookup")
	}

	id := draft.ID
	updated, err := store.Save(ctx, SaveInput{
		Title: draft.Title, Slug: draft.Slug, ContentMD: draft.ContentMD + "\n\nrevision text",
		Status: StatusDraft, Tags: draft.Tags, Categories: draft.Categories,
	}, &id)
	if err != nil {
		t.Fatal(err)
	}
	if updated.ContentMD == draft.ContentMD {
		t.Fatal("draft update failed")
	}

	revisions, err := store.ListRevisions(ctx, draft.ID, 50)
	if err != nil || len(revisions) == 0 {
		t.Fatalf("revisions=%d err=%v", len(revisions), err)
	}
	restored, err := store.RestoreRevision(ctx, draft.ID, revisions[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.ContentMD != draft.ContentMD {
		t.Fatal("revision restore mismatch")
	}

	id = restored.ID
	again, err := store.Save(ctx, SaveInput{
		Title: restored.Title, Slug: restored.Slug, ContentMD: restored.ContentMD + "\n\nrevision text",
		Status: StatusDraft, Tags: restored.Tags, Categories: restored.Categories,
	}, &id)
	if err != nil {
		t.Fatal(err)
	}

	id = again.ID
	published, err := store.Save(ctx, SaveInput{
		Title: again.Title, Slug: again.Slug, ContentMD: again.ContentMD, Status: StatusPublished,
		Tags: again.Tags, Categories: again.Categories,
	}, &id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetPublishedBySlug(ctx, published.Slug); err != nil {
		t.Fatal(err)
	}

	search, err := store.ListPublished(ctx, "alpha_unique_term", 20)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, post := range search {
		if post.ID == published.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("FTS search did not find published post")
	}

	future := time.Now().Add(time.Hour).UnixMilli()
	scheduled, err := store.Save(ctx, SaveInput{
		Title: "Scheduled", Slug: "scheduled", ContentMD: "# Scheduled\n\nfuture_unique_term",
		Status: StatusScheduled, PublishedAt: &future,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetPublishedBySlug(ctx, scheduled.Slug); err == nil {
		t.Fatal("future scheduled post leaked early")
	}

	past := time.Now().Add(-time.Second).UnixMilli()
	id = scheduled.ID
	_, err = store.Save(ctx, SaveInput{
		Title: scheduled.Title, Slug: scheduled.Slug, ContentMD: scheduled.ContentMD,
		Status: StatusScheduled, PublishedAt: &past,
	}, &id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetPublishedBySlug(ctx, scheduled.Slug); err != nil {
		t.Fatal("elapsed scheduled post not visible")
	}
}

func TestTaxonomyRenameKeepsRelations(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "taxonomy.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()

	post, err := store.Save(ctx, SaveInput{
		Title: "Taxonomy", ContentMD: "body", Status: StatusDraft,
		Tags: []string{"Old Tag"}, Categories: []string{"Old Category"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	details, err := store.ListTaxonomyDetails(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(details.Tags) != 1 || len(details.Categories) != 1 {
		t.Fatalf("details=%#v", details)
	}
	if err := store.RenameTaxonomy(ctx, TaxonomyTag, details.Tags[0].ID, "New Tag"); err != nil {
		t.Fatal(err)
	}
	if err := store.RenameTaxonomy(ctx, TaxonomyCategory, details.Categories[0].ID, "New Category"); err != nil {
		t.Fatal(err)
	}
	post, err = store.GetByID(ctx, post.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(post.Tags) != 1 || post.Tags[0] != "New Tag" || len(post.Categories) != 1 || post.Categories[0] != "New Category" {
		t.Fatalf("relations not preserved: %#v", post)
	}
}
