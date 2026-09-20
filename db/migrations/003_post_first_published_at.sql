ALTER TABLE posts ADD COLUMN first_published_at INTEGER;

UPDATE posts
SET first_published_at = published_at
WHERE published_at IS NOT NULL
  AND (
    status = 'published'
    OR (
      status = 'scheduled'
      AND published_at <= CAST(strftime('%s','now') AS INTEGER) * 1000
    )
  );

CREATE INDEX IF NOT EXISTS idx_posts_first_published_at ON posts(first_published_at);
