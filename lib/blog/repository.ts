import { getDb } from "@/lib/db";
import { excerptFrom, hasFrontMatter, looksLikeFrontMatterExcerpt, markdownToText } from "@/lib/blog/markdown";
export { markdownToText } from "@/lib/blog/markdown";

export type PostStatus = "draft" | "published" | "scheduled";

export type PostRecord = {
  id: number; slug: string; title: string; excerpt: string; contentMd: string; status: PostStatus;
  pinned: boolean; seoTitle: string; seoDescription: string; publishedAt: number | null; firstPublishedAt: number | null;
  createdAt: number; updatedAt: number; tags: string[]; categories: string[];
};

type PostRow = {
  id: number; slug: string; title: string; excerpt: string; contentMd: string; status: PostStatus;
  pinned: number; seoTitle: string; seoDescription: string; publishedAt: number | null; firstPublishedAt: number | null;
  createdAt: number; updatedAt: number;
};

export type SavePostInput = {
  title: string; slug?: string; excerpt?: string; contentMd: string; status: PostStatus; pinned?: boolean;
  seoTitle?: string; seoDescription?: string; publishedAt?: number | null; firstPublishedAt?: number | null; tags?: string[]; categories?: string[];
};

const SELECT_POST = "SELECT id, slug, title, excerpt, content_md AS contentMd, status, pinned, seo_title AS seoTitle, seo_description AS seoDescription, published_at AS publishedAt, first_published_at AS firstPublishedAt, created_at AS createdAt, updated_at AS updatedAt FROM posts";

function mapRow(row: PostRow): PostRecord {
  const db = getDb();
  const tags = db.prepare("SELECT tags.name AS name FROM tags JOIN post_tags ON post_tags.tag_id = tags.id WHERE post_tags.post_id = ? ORDER BY tags.name").all(row.id) as Array<{ name: string }>;
  const categories = db.prepare("SELECT categories.name AS name FROM categories JOIN post_categories ON post_categories.category_id = categories.id WHERE post_categories.post_id = ? ORDER BY categories.name").all(row.id) as Array<{ name: string }>;
  const excerpt = !row.excerpt || (hasFrontMatter(row.contentMd) && looksLikeFrontMatterExcerpt(row.excerpt))
    ? excerptFrom(row.contentMd, row.title)
    : row.excerpt;
  return {
    id: row.id, slug: row.slug, title: row.title, excerpt, contentMd: row.contentMd, status: row.status,
    pinned: row.pinned === 1, seoTitle: row.seoTitle, seoDescription: row.seoDescription,
    publishedAt: row.publishedAt, firstPublishedAt: row.firstPublishedAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt, tags: tags.map((item) => item.name), categories: categories.map((item) => item.name)
  };
}

export function normalizeSlug(value: string) {
  const slug = value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]+/gu, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return slug || "post";
}

function uniqueSlug(requested: string, exceptId?: number) {
  const db = getDb();
  const base = normalizeSlug(requested);
  let value = base;
  let index = 2;
  while (true) {
    const row = db.prepare("SELECT id FROM posts WHERE slug = ? AND (? IS NULL OR id != ?) LIMIT 1").get(value, exceptId ?? null, exceptId ?? null) as { id: number } | undefined;
    if (!row) return value;
    value = base + "-" + index++;
  }
}

function normalizeNames(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 30);
}

function uniqueTaxonomySlug(table: "tags" | "categories", name: string) {
  const db = getDb();
  const base = normalizeSlug(name);
  let value = base;
  let index = 2;
  while (db.prepare("SELECT 1 FROM " + table + " WHERE slug = ? LIMIT 1").get(value)) value = base + "-" + index++;
  return value;
}

function ensureTag(name: string) {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE LIMIT 1").get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const now = Date.now();
  const result = db.prepare("INSERT INTO tags (slug, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(uniqueTaxonomySlug("tags", name), name, now, now);
  return Number(result.lastInsertRowid);
}

function ensureCategory(name: string) {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE LIMIT 1").get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const now = Date.now();
  const result = db.prepare("INSERT INTO categories (slug, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(uniqueTaxonomySlug("categories", name), name, "", now, now);
  return Number(result.lastInsertRowid);
}

function syncRelations(postId: number, tags?: string[], categories?: string[]) {
  const db = getDb();
  if (tags !== undefined) {
    db.prepare("DELETE FROM post_tags WHERE post_id = ?").run(postId);
    const insert = db.prepare("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)");
    for (const name of normalizeNames(tags)) insert.run(postId, ensureTag(name));
  }
  if (categories !== undefined) {
    db.prepare("DELETE FROM post_categories WHERE post_id = ?").run(postId);
    const insert = db.prepare("INSERT OR IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)");
    for (const name of normalizeNames(categories)) insert.run(postId, ensureCategory(name));
  }
}

function syncFts(postId: number, title: string, excerpt: string, contentMd: string) {
  const db = getDb();
  db.prepare("DELETE FROM posts_fts WHERE rowid = ?").run(postId);
  db.prepare("INSERT INTO posts_fts (rowid, title, excerpt, content_text) VALUES (?, ?, ?, ?)").run(postId, title, excerpt, markdownToText(contentMd));
}

export function savePost(input: SavePostInput, id?: number) {
  const db = getDb();
  const now = Date.now();
  const title = input.title.trim();
  if (!title) throw new Error("title_required");
  const existing = id ? db.prepare(SELECT_POST + " WHERE id = ? LIMIT 1").get(id) as PostRow | undefined : undefined;
  if (id && !existing) throw new Error("post_not_found");
  const slug = uniqueSlug(input.slug?.trim() || title, id);
  const excerpt = input.excerpt?.trim() || excerptFrom(input.contentMd, title);

  let publishedAt = input.publishedAt ?? null;
  if (publishedAt == null && existing?.publishedAt != null && input.status === existing.status) {
    publishedAt = existing.publishedAt;
  }
  if (input.status === "published" && publishedAt == null) publishedAt = now;
  if (input.status === "scheduled" && publishedAt == null) throw new Error("scheduled_time_required");
  if (input.status === "draft") publishedAt = null;

  let firstPublishedAt = input.firstPublishedAt ?? existing?.firstPublishedAt ?? null;
  if (firstPublishedAt == null && input.status === "published") firstPublishedAt = now;
  if (firstPublishedAt == null && input.status === "scheduled" && publishedAt != null && publishedAt <= now) {
    firstPublishedAt = publishedAt;
  }

  let postId = id ?? 0;
  db.transaction(() => {
    if (existing && id) {
      if (existing.contentMd !== input.contentMd || existing.title !== title) {
        db.prepare("INSERT INTO post_revisions (post_id, content_md, metadata_json, created_at) VALUES (?, ?, ?, ?)").run(id, existing.contentMd, JSON.stringify({ title: existing.title, slug: existing.slug, excerpt: existing.excerpt, status: existing.status, publishedAt: existing.publishedAt, firstPublishedAt: existing.firstPublishedAt }), now);
      }
      db.prepare("UPDATE posts SET slug = ?, title = ?, excerpt = ?, content_md = ?, status = ?, pinned = ?, seo_title = ?, seo_description = ?, published_at = ?, first_published_at = ?, updated_at = ? WHERE id = ?").run(slug, title, excerpt, input.contentMd, input.status, input.pinned ? 1 : 0, input.seoTitle?.trim() ?? "", input.seoDescription?.trim() ?? "", publishedAt, firstPublishedAt, now, id);
      postId = id;
    } else {
      const result = db.prepare("INSERT INTO posts (slug, title, excerpt, content_md, status, pinned, seo_title, seo_description, published_at, first_published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(slug, title, excerpt, input.contentMd, input.status, input.pinned ? 1 : 0, input.seoTitle?.trim() ?? "", input.seoDescription?.trim() ?? "", publishedAt, firstPublishedAt, now, now);
      postId = Number(result.lastInsertRowid);
    }
    syncRelations(postId, input.tags, input.categories);
    syncFts(postId, title, excerpt, input.contentMd);
  })();
  return getPostById(postId)!;
}

export function deletePost(id: number) {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM posts_fts WHERE rowid = ?").run(id);
    db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  })();
}

export type PostRevisionRecord = {
  id: number;
  postId: number;
  contentMd: string;
  metadata: Record<string, unknown>;
  createdAt: number;
};

export function listPostRevisions(postId: number, limit = 50): PostRevisionRecord[] {
  const rows = getDb().prepare(
    "SELECT id, post_id AS postId, content_md AS contentMd, metadata_json AS metadataJson, created_at AS createdAt FROM post_revisions WHERE post_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
  ).all(postId, limit) as Array<{ id: number; postId: number; contentMd: string; metadataJson: string; createdAt: number }>;

  return rows.map((row) => {
    let metadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.metadataJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed;
    } catch {}
    return { id: row.id, postId: row.postId, contentMd: row.contentMd, metadata, createdAt: row.createdAt };
  });
}

export function restorePostRevision(postId: number, revisionId: number) {
  const current = getPostById(postId);
  if (!current) throw new Error("post_not_found");
  const revision = getDb().prepare(
    "SELECT id, content_md AS contentMd, metadata_json AS metadataJson FROM post_revisions WHERE id = ? AND post_id = ? LIMIT 1"
  ).get(revisionId, postId) as { id: number; contentMd: string; metadataJson: string } | undefined;
  if (!revision) throw new Error("revision_not_found");

  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(revision.metadataJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed;
  } catch {}

  const revisionStatus =
    metadata.status === "published" || metadata.status === "scheduled" ? metadata.status : "draft";
  const publishedAt = typeof metadata.publishedAt === "number" ? metadata.publishedAt : null;
  const firstPublishedAt = typeof metadata.firstPublishedAt === "number" ? metadata.firstPublishedAt : current.firstPublishedAt;

  return savePost({
    title: typeof metadata.title === "string" ? metadata.title : current.title,
    slug: typeof metadata.slug === "string" ? metadata.slug : current.slug,
    excerpt: typeof metadata.excerpt === "string" ? metadata.excerpt : current.excerpt,
    contentMd: revision.contentMd,
    status: revisionStatus,
    pinned: current.pinned,
    seoTitle: current.seoTitle,
    seoDescription: current.seoDescription,
    publishedAt,
    firstPublishedAt,
    tags: current.tags,
    categories: current.categories
  }, postId);
}

export function getPostById(id: number) {
  const row = getDb().prepare(SELECT_POST + " WHERE id = ? LIMIT 1").get(id) as PostRow | undefined;
  return row ? mapRow(row) : null;
}

export function getPublishedPostBySlug(slug: string) {
  const now = Date.now();
  const row = getDb().prepare(SELECT_POST + " WHERE slug = ? AND (status = 'published' OR (status = 'scheduled' AND published_at <= ?)) LIMIT 1").get(slug, now) as PostRow | undefined;
  return row ? mapRow(row) : null;
}

function ftsQuery(query: string) {
  return query.trim().split(/\s+/).filter(Boolean).slice(0, 8).map((token) => '"' + token.replace(/"/g, '""') + '"*').join(" AND ");
}

export function listPublishedPosts(query = "", limit = 30) {
  const db = getDb();
  const now = Date.now();
  let rows: PostRow[];
  if (query.trim()) {
    const match = ftsQuery(query);
    try {
      const selectWithFts = "SELECT posts.id AS id, posts.slug AS slug, posts.title AS title, posts.excerpt AS excerpt, posts.content_md AS contentMd, posts.status AS status, posts.pinned AS pinned, posts.seo_title AS seoTitle, posts.seo_description AS seoDescription, posts.published_at AS publishedAt, posts.first_published_at AS firstPublishedAt, posts.created_at AS createdAt, posts.updated_at AS updatedAt FROM posts JOIN posts_fts ON posts_fts.rowid = posts.id";
      rows = db.prepare(selectWithFts + " WHERE posts_fts MATCH ? AND (posts.status = 'published' OR (posts.status = 'scheduled' AND posts.published_at <= ?)) ORDER BY posts.pinned DESC, bm25(posts_fts), posts.published_at DESC, posts.id DESC LIMIT ?").all(match, now, limit) as PostRow[];
    } catch {
      const like = "%" + query.trim() + "%";
      rows = db.prepare(SELECT_POST + " WHERE (title LIKE ? OR excerpt LIKE ? OR content_md LIKE ?) AND (status = 'published' OR (status = 'scheduled' AND published_at <= ?)) ORDER BY pinned DESC, published_at DESC, id DESC LIMIT ?").all(like, like, like, now, limit) as PostRow[];
    }
  } else {
    rows = db.prepare(SELECT_POST + " WHERE (status = 'published' OR (status = 'scheduled' AND published_at <= ?)) ORDER BY pinned DESC, published_at DESC, id DESC LIMIT ?").all(now, limit) as PostRow[];
  }
  return rows.map(mapRow);
}

export function filterPublishedPosts(options: { query?: string; tag?: string; category?: string; limit?: number } = {}) {
  const query = options.query ?? "";
  const tag = options.tag?.trim().toLocaleLowerCase() ?? "";
  const category = options.category?.trim().toLocaleLowerCase() ?? "";
  const limit = options.limit ?? 30;
  return listPublishedPosts(query, tag || category ? 200 : limit)
    .filter((post) => !tag || post.tags.some((value) => value.toLocaleLowerCase() === tag))
    .filter((post) => !category || post.categories.some((value) => value.toLocaleLowerCase() === category))
    .slice(0, limit);
}

export function getAdjacentPublishedPosts(id: number) {
  const posts = listPublishedPosts("", 200);
  const index = posts.findIndex((post) => post.id === id);
  if (index < 0) return { newer: null, older: null };
  return {
    newer: index > 0 ? posts[index - 1] : null,
    older: index < posts.length - 1 ? posts[index + 1] : null
  };
}

export function listAdminPosts() {
  return (getDb().prepare(SELECT_POST + " ORDER BY updated_at DESC, id DESC").all() as PostRow[]).map(mapRow);
}

export type TaxonomyKind = "tag" | "category";

export type TaxonomyDetail = {
  id: number;
  name: string;
  slug: string;
  count: number;
};

function taxonomyTable(kind: TaxonomyKind) {
  return kind === "tag"
    ? { table: "tags", joinTable: "post_tags", foreignKey: "tag_id" }
    : { table: "categories", joinTable: "post_categories", foreignKey: "category_id" };
}

export function listTaxonomyDetails() {
  const db = getDb();
  const tags = db.prepare(
    "SELECT tags.id AS id, tags.name AS name, tags.slug AS slug, COUNT(post_tags.post_id) AS count " +
    "FROM tags LEFT JOIN post_tags ON post_tags.tag_id = tags.id GROUP BY tags.id ORDER BY tags.name"
  ).all() as TaxonomyDetail[];
  const categories = db.prepare(
    "SELECT categories.id AS id, categories.name AS name, categories.slug AS slug, COUNT(post_categories.post_id) AS count " +
    "FROM categories LEFT JOIN post_categories ON post_categories.category_id = categories.id GROUP BY categories.id ORDER BY categories.name"
  ).all() as TaxonomyDetail[];
  return { tags, categories };
}

export function createTaxonomy(kind: TaxonomyKind, rawName: string) {
  const name = rawName.trim();
  if (!name) throw new Error("taxonomy_name_required");
  const db = getDb();
  const meta = taxonomyTable(kind);
  const existing = db.prepare("SELECT id FROM " + meta.table + " WHERE name = ? COLLATE NOCASE LIMIT 1").get(name);
  if (existing) throw new Error("taxonomy_name_exists");
  return kind === "tag" ? ensureTag(name) : ensureCategory(name);
}

export function renameTaxonomy(kind: TaxonomyKind, id: number, rawName: string) {
  const name = rawName.trim();
  if (!name) throw new Error("taxonomy_name_required");
  const db = getDb();
  const meta = taxonomyTable(kind);
  const current = db.prepare("SELECT id, name, slug FROM " + meta.table + " WHERE id = ? LIMIT 1").get(id) as { id: number; name: string; slug: string } | undefined;
  if (!current) throw new Error("taxonomy_not_found");

  const duplicate = db.prepare("SELECT id FROM " + meta.table + " WHERE name = ? COLLATE NOCASE AND id != ? LIMIT 1").get(name, id);
  if (duplicate) throw new Error("taxonomy_name_exists");

  let slug = normalizeSlug(name);
  let suffix = 2;
  while (db.prepare("SELECT id FROM " + meta.table + " WHERE slug = ? AND id != ? LIMIT 1").get(slug, id)) {
    slug = normalizeSlug(name) + "-" + suffix++;
  }

  db.prepare("UPDATE " + meta.table + " SET name = ?, slug = ?, updated_at = ? WHERE id = ?").run(name, slug, Date.now(), id);
}

export function deleteTaxonomy(kind: TaxonomyKind, id: number) {
  const meta = taxonomyTable(kind);
  return getDb().prepare("DELETE FROM " + meta.table + " WHERE id = ?").run(id).changes > 0;
}

export function listTaxonomy() {
  const db = getDb();
  return {
    tags: (db.prepare("SELECT name FROM tags ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name),
    categories: (db.prepare("SELECT name FROM categories ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name)
  };
}

export function archiveCounts() {
  return getDb().prepare("SELECT strftime('%Y', published_at / 1000, 'unixepoch', 'localtime') AS year, COUNT(*) AS count FROM posts WHERE status = 'published' AND published_at IS NOT NULL GROUP BY year ORDER BY year DESC").all() as Array<{ year: string; count: number }>;
}
