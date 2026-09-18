PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent_hint TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  size INTEGER NOT NULL DEFAULT 0,
  alt TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL DEFAULT '',
  cover_media_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','scheduled')),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (cover_media_id) REFERENCES media(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_status_published_at ON posts(status, published_at);
CREATE INDEX IF NOT EXISTS idx_posts_updated_at ON posts(updated_at);

CREATE TABLE IF NOT EXISTS post_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  content_md TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_post_revisions_post_id ON post_revisions(post_id, created_at DESC);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS post_categories (
  post_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (post_id, category_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (post_id, tag_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nav_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  extra_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nav_groups_sort_order ON nav_groups(sort_order);

CREATE TABLE IF NOT EXISTS nav_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT,
  group_id INTEGER NOT NULL,
  parent_id INTEGER,
  type TEXT NOT NULL DEFAULT 'link' CHECK (type IN ('link','folder')),
  name TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  icon_url TEXT NOT NULL DEFAULT '',
  icon_text TEXT NOT NULL DEFAULT '',
  background_color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '1x1',
  visit_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  browser_local INTEGER NOT NULL DEFAULT 0 CHECK (browser_local IN (0,1)),
  extra_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (group_id) REFERENCES nav_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES nav_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_nav_items_group_sort ON nav_items(group_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_nav_items_parent_sort ON nav_items(parent_id, sort_order);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title,
  excerpt,
  content_text,
  content='',
  tokenize='unicode61'
);
