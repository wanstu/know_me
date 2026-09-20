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

	if _, err := store.Save(ctx, SaveInput{
		Title: "Missing Schedule", Slug: "missing-schedule", ContentMD: "body", Status: StatusScheduled,
	}, nil); err == nil || err.Error() != "scheduled_time_required" {
		t.Fatalf("expected scheduled_time_required, got %v", err)
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
	archives, err := store.ArchiveCounts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	currentYear := time.Now().Format("2006")
	foundYear := false
	for _, archive := range archives {
		if archive.Year == currentYear {
			foundYear = true
			if archive.Count != 2 {
				t.Fatalf("archive count=%d want 2 for %s", archive.Count, currentYear)
			}
		}
	}
	if !foundYear {
		t.Fatalf("current archive year missing: %#v", archives)
	}

	transitionFuture := time.Now().Add(2 * time.Hour).UnixMilli()
	transition, err := store.Save(ctx, SaveInput{
		Title: "Transition", Slug: "transition", ContentMD: "body",
		Status: StatusScheduled, PublishedAt: &transitionFuture,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	id = transition.ID
	editedScheduled, err := store.Save(ctx, SaveInput{
		Title: transition.Title, Slug: transition.Slug, ContentMD: transition.ContentMD + " edited",
		Status: StatusScheduled,
	}, &id)
	if err != nil {
		t.Fatal(err)
	}
	if editedScheduled.PublishedAt == nil || *editedScheduled.PublishedAt != transitionFuture {
		t.Fatalf("scheduled edit lost publish time: %#v", editedScheduled.PublishedAt)
	}

	beforePublish := time.Now().Add(-time.Second).UnixMilli()
	id = editedScheduled.ID
	publishedNow, err := store.Save(ctx, SaveInput{
		Title: editedScheduled.Title, Slug: editedScheduled.Slug, ContentMD: editedScheduled.ContentMD,
		Status: StatusPublished,
	}, &id)
	if err != nil {
		t.Fatal(err)
	}
	afterPublish := time.Now().Add(time.Second).UnixMilli()
	if publishedNow.PublishedAt == nil || *publishedNow.PublishedAt < beforePublish || *publishedNow.PublishedAt > afterPublish || *publishedNow.PublishedAt >= transitionFuture {
		t.Fatalf("scheduled -> published kept wrong timestamp: %#v", publishedNow.PublishedAt)
	}
	id = publishedNow.ID
	if _, err := store.Save(ctx, SaveInput{
		Title: publishedNow.Title, Slug: publishedNow.Slug, ContentMD: publishedNow.ContentMD,
		Status: StatusScheduled,
	}, &id); err == nil || err.Error() != "scheduled_time_required" {
		t.Fatalf("published -> scheduled without new time should fail, got %v", err)
	}

	if _, err := store.Save(ctx, SaveInput{
		Title: "Private Taxonomy", ContentMD: "draft only", Status: StatusDraft,
		Tags: []string{"Draft Only Tag"}, Categories: []string{"Draft Only Category"},
	}, nil); err != nil {
		t.Fatal(err)
	}
	publicTaxonomy, err := store.ListTaxonomy(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range publicTaxonomy["tags"] {
		if value == "Draft Only Tag" {
			t.Fatalf("draft-only tag leaked publicly: %#v", publicTaxonomy)
		}
	}
	for _, value := range publicTaxonomy["categories"] {
		if value == "Draft Only Category" {
			t.Fatalf("draft-only category leaked publicly: %#v", publicTaxonomy)
		}
	}
}

func TestFilterPublishedPage(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "page.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()
	base := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 5; i++ {
		publishedAt := base.Add(time.Duration(i) * time.Minute).UnixMilli()
		if _, err := store.Save(ctx, SaveInput{
			Title:       "Page Post " + string(rune('A'+i)),
			Slug:        "page-post-" + string(rune('a'+i)),
			ContentMD:   "pagination marker",
			Status:      StatusPublished,
			PublishedAt: &publishedAt,
			Tags:        []string{"Paged"},
			Categories:  []string{"Notes"},
		}, nil); err != nil {
			t.Fatal(err)
		}
	}
	page, total, actualPage, err := store.FilterPublishedPage(ctx, "pagination", "Paged", "Notes", "2026", 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	if total != 5 || len(page) != 2 || actualPage != 2 {
		t.Fatalf("total=%d actualPage=%d page=%#v", total, actualPage, page)
	}
	if page[0].Slug != "page-post-c" || page[1].Slug != "page-post-b" {
		t.Fatalf("unexpected page order=%#v", page)
	}
	empty, total, actualPage, err := store.FilterPublishedPage(ctx, "", "", "", "1900", 999, 20)
	if err != nil {
		t.Fatal(err)
	}
	if total != 0 || len(empty) != 0 || actualPage != 1 {
		t.Fatalf("unexpected old year result total=%d actualPage=%d posts=%#v", total, actualPage, empty)
	}
	lastPage, total, actualPage, err := store.FilterPublishedPage(ctx, "pagination", "Paged", "Notes", "2026", 999, 2)
	if err != nil {
		t.Fatal(err)
	}
	if total != 5 || actualPage != 3 || len(lastPage) != 1 || lastPage[0].Slug != "page-post-a" {
		t.Fatalf("clamped page total=%d actualPage=%d posts=%#v", total, actualPage, lastPage)
	}
}

func TestTaxonomyMergeKeepsAndDeduplicatesRelations(t *testing.T) {
	t.Parallel()
	db, err := database.Open(filepath.Join(t.TempDir(), "taxonomy-merge.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db.SQL)
	ctx := context.Background()

	first, err := store.Save(ctx, SaveInput{
		Title: "First", ContentMD: "body", Status: StatusDraft,
		Tags: []string{"Source Tag", "Target Tag"}, Categories: []string{"Source Category", "Target Category"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Save(ctx, SaveInput{
		Title: "Second", ContentMD: "body", Status: StatusDraft,
		Tags: []string{"Source Tag"}, Categories: []string{"Source Category"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	details, err := store.ListTaxonomyDetails(ctx)
	if err != nil {
		t.Fatal(err)
	}
	findID := func(values []TaxonomyDetail, name string) int64 {
		for _, item := range values {
			if item.Name == name {
				return item.ID
			}
		}
		return 0
	}
	sourceTag := findID(details.Tags, "Source Tag")
	targetTag := findID(details.Tags, "Target Tag")
	sourceCategory := findID(details.Categories, "Source Category")
	targetCategory := findID(details.Categories, "Target Category")
	if err := store.MergeTaxonomy(ctx, TaxonomyTag, sourceTag, targetTag); err != nil {
		t.Fatal(err)
	}
	if err := store.MergeTaxonomy(ctx, TaxonomyCategory, sourceCategory, targetCategory); err != nil {
		t.Fatal(err)
	}

	for _, id := range []int64{first.ID, second.ID} {
		post, err := store.GetByID(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if len(post.Tags) != 1 || post.Tags[0] != "Target Tag" {
			t.Fatalf("post %d tags=%#v", id, post.Tags)
		}
		if len(post.Categories) != 1 || post.Categories[0] != "Target Category" {
			t.Fatalf("post %d categories=%#v", id, post.Categories)
		}
	}
	details, err = store.ListTaxonomyDetails(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if findID(details.Tags, "Source Tag") != 0 || findID(details.Categories, "Source Category") != 0 {
		t.Fatalf("source taxonomy survived merge: %#v", details)
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
