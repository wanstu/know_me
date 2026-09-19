DROP TABLE IF EXISTS posts_fts;

CREATE VIRTUAL TABLE posts_fts USING fts5(
  title,
  excerpt,
  content_text,
  tokenize='unicode61'
);

INSERT INTO posts_fts (rowid, title, excerpt, content_text)
SELECT id, title, excerpt, content_md
FROM posts;
