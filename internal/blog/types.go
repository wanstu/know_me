package blog

type Status string

const (
	StatusDraft     Status = "draft"
	StatusPublished Status = "published"
	StatusScheduled Status = "scheduled"
)

type Post struct {
	ID               int64    `json:"id"`
	Slug             string   `json:"slug"`
	Title            string   `json:"title"`
	Excerpt          string   `json:"excerpt"`
	ContentMD        string   `json:"contentMd"`
	Status           Status   `json:"status"`
	Pinned           bool     `json:"pinned"`
	SEOTitle         string   `json:"seoTitle"`
	SEODescription   string   `json:"seoDescription"`
	PublishedAt      *int64   `json:"publishedAt"`
	FirstPublishedAt *int64   `json:"firstPublishedAt"`
	CreatedAt        int64    `json:"createdAt"`
	UpdatedAt        int64    `json:"updatedAt"`
	Tags             []string `json:"tags"`
	Categories       []string `json:"categories"`
}

type SaveInput struct {
	Title            string
	Slug             string
	Excerpt          string
	ContentMD        string
	Status           Status
	Pinned           bool
	SEOTitle         string
	SEODescription   string
	PublishedAt      *int64
	FirstPublishedAt *int64
	Tags             []string
	Categories       []string
}

type Revision struct {
	ID        int64          `json:"id"`
	PostID    int64          `json:"postId"`
	ContentMD string         `json:"contentMd"`
	Metadata  map[string]any `json:"metadata"`
	CreatedAt int64          `json:"createdAt"`
}

type TaxonomyKind string

const (
	TaxonomyTag      TaxonomyKind = "tag"
	TaxonomyCategory TaxonomyKind = "category"
)

type TaxonomyDetail struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	Count int64  `json:"count"`
}

type TaxonomyDetails struct {
	Tags       []TaxonomyDetail `json:"tags"`
	Categories []TaxonomyDetail `json:"categories"`
}

type ArchiveCount struct {
	Year  string `json:"year"`
	Count int64  `json:"count"`
}
