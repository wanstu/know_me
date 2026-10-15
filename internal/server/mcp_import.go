package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wanstu/know_me/internal/blog"
	"gopkg.in/yaml.v3"
)

// Import is deliberately document-based. MCP clients fetch source materials;
// the Know Me server does not fetch arbitrary caller-controlled URLs.
type mcpImportDocument struct {
	Path     string `json:"path" jsonschema:"Source path, e.g. source/_posts/java/example.md"`
	Markdown string `json:"markdown" jsonschema:"Full UTF-8 Markdown file with optional YAML Front Matter"`
}
type mcpImportRequest struct {
	Documents []mcpImportDocument `json:"documents" jsonschema:"1-50 Markdown files; maximum 256 KiB per document"`
	Publish   bool                `json:"publish,omitempty" jsonschema:"When true, import as published with historical Front Matter dates; otherwise create drafts"`
}
type mcpImportApply struct {
	Documents   []mcpImportDocument `json:"documents"`
	Publish     bool                `json:"publish,omitempty"`
	PreviewHash string              `json:"previewHash" jsonschema:"Exact hash returned by posts_import_preview for the same documents and publish option"`
	Confirm     bool                `json:"confirm" jsonschema:"Must be true to write articles"`
}
type mcpImportItem struct {
	Path        string   `json:"path"`
	Title       string   `json:"title,omitempty"`
	Slug        string   `json:"slug,omitempty"`
	Status      string   `json:"status,omitempty"`
	Action      string   `json:"action"`
	Reason      string   `json:"reason,omitempty"`
	PublishedAt *int64   `json:"publishedAt,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Categories  []string `json:"categories,omitempty"`
	Warnings    []string `json:"warnings,omitempty"`
	ID          int64    `json:"id,omitempty"`
}
type mcpImportPlan struct {
	Items       []mcpImportItem `json:"items"`
	PreviewHash string          `json:"previewHash"`
	Create      int             `json:"create"`
	Skip        int             `json:"skip"`
	Invalid     int             `json:"invalid"`
}
type parsedImport struct {
	item  mcpImportItem
	input blog.SaveInput
}

var frontMatterSplit = regexp.MustCompile(`\r?\n`)

func trimScalar(v any) string {
	if v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x)
	case time.Time:
		return x.Format(time.RFC3339)
	default:
		return strings.TrimSpace(fmt.Sprint(x))
	}
}
func importNames(v any) []string {
	out := []string{}
	switch x := v.(type) {
	case []any:
		for _, elem := range x {
			if nested, ok := elem.([]any); ok {
				out = append(out, importNames(nested)...)
				continue
			}
			if name := trimScalar(elem); name != "" {
				out = append(out, name)
			}
		}
	case string:
		if strings.ContainsAny(x, ",，") {
			out = append(out, strings.FieldsFunc(x, func(r rune) bool { return r == ',' || r == '，' })...)
		} else if strings.TrimSpace(x) != "" {
			out = append(out, x)
		}
	}
	clean := make([]string, 0, len(out))
	seen := map[string]bool{}
	for _, v := range out {
		v = strings.TrimSpace(v)
		key := strings.ToLower(v)
		if v != "" && !seen[key] {
			clean = append(clean, v)
			seen[key] = true
		}
	}
	return clean
}
func importDate(v any) (*int64, error) {
	if v == nil || trimScalar(v) == "" {
		return nil, nil
	}
	text := trimScalar(v)
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05 -0700", "2006-01-02 15:04:05 -07:00"} {
		if d, err := time.Parse(layout, text); err == nil {
			ms := d.UnixMilli()
			if !validMCPMillis(ms) {
				return nil, errors.New("date_out_of_range")
			}
			return &ms, nil
		}
	}
	// Hexo timestamps without explicit timezone conventionally use the site timezone.
	loc := time.FixedZone("UTC+08", 8*3600)
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02 15:04", "2006-01-02"} {
		if d, err := time.ParseInLocation(layout, text, loc); err == nil {
			ms := d.UnixMilli()
			if !validMCPMillis(ms) {
				return nil, errors.New("date_out_of_range")
			}
			return &ms, nil
		}
	}
	return nil, errors.New("invalid_front_matter_date")
}
func parseImportDocument(doc mcpImportDocument, publish bool) (parsedImport, error) {
	filename := strings.TrimSpace(strings.ReplaceAll(doc.Path, "\\", "/"))
	if filename == "" || len(filename) > 512 || strings.HasPrefix(filename, "/") || strings.Contains(filename, "\x00") || strings.Contains(filename, ":") {
		return parsedImport{}, errors.New("invalid_source_path")
	}
	for _, segment := range strings.Split(filename, "/") {
		if segment == ".." || segment == "." || segment == "" {
			return parsedImport{}, errors.New("invalid_source_path")
		}
	}
	if !strings.EqualFold(path.Ext(filename), ".md") {
		return parsedImport{}, errors.New("not_markdown")
	}
	markdown := strings.TrimPrefix(doc.Markdown, "\ufeff")
	if strings.TrimSpace(markdown) == "" {
		return parsedImport{}, errors.New("empty_markdown")
	}
	meta := map[string]any{}
	body := markdown
	if strings.HasPrefix(markdown, "---\n") || strings.HasPrefix(markdown, "---\r\n") {
		lines := frontMatterSplit.Split(markdown, -1)
		closeIndex := -1
		for i := 1; i < len(lines); i++ {
			if strings.TrimSpace(lines[i]) == "---" || strings.TrimSpace(lines[i]) == "..." {
				closeIndex = i
				break
			}
		}
		if closeIndex < 0 {
			return parsedImport{}, errors.New("unterminated_front_matter")
		}
		yamlBytes := []byte(strings.Join(lines[1:closeIndex], "\n"))
		if err := yaml.Unmarshal(yamlBytes, &meta); err != nil {
			return parsedImport{}, fmt.Errorf("invalid_front_matter: %w", err)
		}
		// yaml.v3 auto-coerces bare dates into UTC time.Time, even when the
		// original Hexo source had no timezone. Preserve raw date scalars so
		// importDate can apply the documented UTC+08 default consistently.
		var document yaml.Node
		if err := yaml.Unmarshal(yamlBytes, &document); err != nil {
			return parsedImport{}, fmt.Errorf("invalid_front_matter: %w", err)
		}
		if len(document.Content) > 0 && document.Content[0].Kind == yaml.MappingNode {
			fields := document.Content[0].Content
			for i := 0; i+1 < len(fields); i += 2 {
				if fields[i].Value == "date" || fields[i].Value == "firstPublishedAt" {
					meta[fields[i].Value] = fields[i+1].Value
				}
			}
		}
		body = strings.Join(lines[closeIndex+1:], "\n")
	}
	if strings.TrimSpace(body) == "" {
		return parsedImport{}, errors.New("empty_markdown_body")
	}
	base := strings.TrimSuffix(path.Base(filename), path.Ext(filename))
	title := trimScalar(meta["title"])
	if title == "" {
		title = base
	}
	if title == "" {
		return parsedImport{}, errors.New("title_required")
	}
	if len([]rune(title)) > 300 {
		return parsedImport{}, errors.New("title_too_long")
	}
	rel := strings.TrimPrefix(filename, "source/_posts/")
	rel = strings.TrimSuffix(rel, path.Ext(rel))
	slugInput := trimScalar(meta["slug"])
	if slugInput == "" {
		slugInput = strings.ReplaceAll(rel, "/", "-")
	}
	slug := blog.NormalizeSlug(slugInput)
	tags := importNames(meta["tags"])
	cats := importNames(meta["categories"])
	if len(cats) == 0 {
		folder := path.Dir(rel)
		if folder != "." && folder != "" {
			cats = []string{strings.Split(folder, "/")[0]}
		}
	}
	date, err := importDate(meta["date"])
	if err != nil {
		return parsedImport{}, err
	}
	firstDate := date
	if value, ok := meta["firstPublishedAt"]; ok {
		firstDate, err = importDate(value)
		if err != nil {
			return parsedImport{}, err
		}
	}
	status := blog.StatusDraft
	warnings := []string{}
	if strings.Contains(body, "](/") || strings.Contains(body, "](./") || strings.Contains(body, "](../") {
		warnings = append(warnings, "Relative image/file URLs are preserved; verify assets after import")
	}
	if publish {
		if raw, ok := meta["draft"].(bool); ok && raw {
			warnings = append(warnings, "Front Matter draft:true kept this article as draft")
		} else {
			status = blog.StatusPublished
		}
	}
	var publishedAt *int64
	if status == blog.StatusPublished {
		publishedAt = date
	}
	if date == nil {
		warnings = append(warnings, "No source date; current time will be used if published")
	}
	if len(tags) > 30 || len(cats) > 30 {
		return parsedImport{}, errors.New("too_many_taxonomies")
	}
	if err := validateMCPPostDates(status, publishedAt, firstDate); err != nil {
		return parsedImport{}, err
	}
	input := blog.SaveInput{Title: title, Slug: slug, ContentMD: body, Excerpt: trimScalar(meta["description"]), Status: status, PublishedAt: publishedAt, FirstPublishedAt: firstDate, Tags: tags, Categories: cats}
	return parsedImport{item: mcpImportItem{Path: filename, Title: title, Slug: slug, Status: string(status), PublishedAt: date, Tags: tags, Categories: cats, Warnings: warnings, Action: "create"}, input: input}, nil
}
func (s *Server) prepareMCPImport(ctx context.Context, req mcpImportRequest) (mcpImportPlan, []parsedImport, error) {
	if len(req.Documents) < 1 || len(req.Documents) > 50 {
		return mcpImportPlan{}, nil, errors.New("documents_count_must_be_1_to_50")
	}
	bytes, _ := json.Marshal(req)
	if len(bytes) > 3*1024*1024 {
		return mcpImportPlan{}, nil, errors.New("import_payload_too_large")
	}
	digest := sha256.Sum256(bytes)
	plan := mcpImportPlan{PreviewHash: hex.EncodeToString(digest[:]), Items: make([]mcpImportItem, 0, len(req.Documents))}
	existing, err := s.blog.ListAdmin(ctx)
	if err != nil {
		return mcpImportPlan{}, nil, err
	}
	slugs := map[string]bool{}
	for _, p := range existing {
		slugs[p.Slug] = true
	}
	seenPath := map[string]bool{}
	prepared := make([]parsedImport, 0, len(req.Documents))
	for _, doc := range req.Documents {
		item := mcpImportItem{Path: doc.Path}
		if len(doc.Markdown) > 256*1024 {
			item.Action = "invalid"
			item.Reason = "document_too_large"
		} else {
			parsed, err := parseImportDocument(doc, req.Publish)
			if err != nil {
				item.Action = "invalid"
				item.Reason = err.Error()
			} else {
				item = parsed.item
				if seenPath[strings.ToLower(parsed.item.Path)] {
					item.Action = "invalid"
					item.Reason = "duplicate_source_path"
				}
				if item.Action == "create" && slugs[parsed.item.Slug] {
					item.Action = "skip"
					item.Reason = "slug_already_exists"
				}
				if item.Action == "create" {
					prepared = append(prepared, parsed)
					slugs[item.Slug] = true
				}
				seenPath[strings.ToLower(parsed.item.Path)] = true
			}
		}
		switch item.Action {
		case "create":
			plan.Create++
		case "skip":
			plan.Skip++
		default:
			plan.Invalid++
		}
		plan.Items = append(plan.Items, item)
	}
	return plan, prepared, nil
}
func registerMCPImportRead(m *mcp.Server, s *Server) {
	addMCPTool(m, "posts_import_preview", "Preview 1-50 Markdown documents with YAML/Hexo Front Matter: titles, dates, categories, tags and duplicate slugs. Never writes.", true, func(ctx context.Context, in mcpImportRequest) (any, error) {
		plan, _, err := s.prepareMCPImport(ctx, in)
		return plan, err
	})
}
func registerMCPImportWrite(m *mcp.Server, s *Server) {
	addMCPTool(m, "posts_import_apply", "Import Markdown documents after preview. Requires matching previewHash and confirm=true; skips existing slugs rather than overwriting.", false, func(ctx context.Context, in mcpImportApply) (any, error) {
		if !in.Confirm {
			return nil, errors.New("explicit_confirmation_required")
		}
		req := mcpImportRequest{Documents: in.Documents, Publish: in.Publish}
		plan, prepared, err := s.prepareMCPImport(ctx, req)
		if err != nil {
			return nil, err
		}
		if in.PreviewHash == "" || plan.PreviewHash != in.PreviewHash {
			return nil, errors.New("preview_hash_mismatch")
		}
		if plan.Invalid > 0 {
			return nil, errors.New("import_contains_invalid_documents")
		}
		// Rechecks after each successful insert make retries safe on the same repo.
		for idx := range plan.Items {
			if plan.Items[idx].Action != "create" {
				continue
			}
			var target *parsedImport
			for j := range prepared {
				if prepared[j].item.Slug == plan.Items[idx].Slug {
					target = &prepared[j]
					break
				}
			}
			if target == nil {
				return nil, errors.New("import_plan_inconsistent")
			}
			exists, err := s.blog.HasSlug(ctx, target.item.Slug)
			if err != nil {
				return nil, err
			}
			if exists {
				plan.Items[idx].Action = "skip"
				plan.Items[idx].Reason = "slug_already_exists"
				plan.Create--
				plan.Skip++
				continue
			}
			p, err := s.blog.CreateWithExactSlug(ctx, target.input)
			if err != nil {
				plan.Items[idx].Action = "error"
				plan.Items[idx].Reason = err.Error()
				plan.Create--
				plan.Invalid++
				continue
			}
			plan.Items[idx].Action = "created"
			plan.Items[idx].ID = p.ID
		}
		// Count only successfully written articles, not still-planned creates.
		created := 0
		for _, item := range plan.Items {
			if item.Action == "created" {
				created++
			}
		}
		return map[string]any{"items": plan.Items, "created": created, "skipped": plan.Skip, "failed": plan.Invalid, "previewHash": plan.PreviewHash}, nil
	})
}
