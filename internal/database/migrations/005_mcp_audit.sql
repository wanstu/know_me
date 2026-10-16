CREATE TABLE IF NOT EXISTS mcp_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  token_id TEXT,
  token_name TEXT,
  token_scope TEXT,
  tool_name TEXT,
  required_permission TEXT,
  target_type TEXT,
  target_id TEXT,
  action TEXT,
  result TEXT NOT NULL,
  reason TEXT,
  http_method TEXT,
  remote_peer TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_recent ON mcp_audit_events(id DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_token ON mcp_audit_events(token_id, id DESC);
