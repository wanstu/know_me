import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const migrations = [
  { id: "001_initial", file: "001_initial.sql" },
  { id: "002_fts_delete_support", file: "002_fts_delete_support.sql" }
] as const;

type Db = Database.Database;

const globalForDb = globalThis as typeof globalThis & {
  __knowMeDb?: Db;
};

function databasePath() {
  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) return path.join(process.cwd(), "data", "know-me.db");
  const value = configured.startsWith("file:") ? configured.slice(5) : configured;
  if (path.isAbsolute(value)) return value;
  const relative = value.replace(/^[.\\/]*data[\\/]/i, "");
  return path.join(process.cwd(), "data", relative);
}

function applyMigrations(db: Db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);");

  const hasMigration = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ? LIMIT 1");
  const markMigration = db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");

  for (const migration of migrations) {
    if (hasMigration.get(migration.id)) continue;

    const sqlPath = path.join(process.cwd(), "db", "migrations", migration.file);
    const sql = fs.readFileSync(sqlPath, "utf8");
    const run = db.transaction(() => {
      db.exec(sql);
      markMigration.run(migration.id, Date.now());
    });
    run();
  }
}

export function getDb(): Db {
  if (globalForDb.__knowMeDb) return globalForDb.__knowMeDb;

  const dbPath = databasePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  applyMigrations(db);

  globalForDb.__knowMeDb = db;
  return db;
}

export function cleanupExpiredSessions(now = Date.now()) {
  return getDb().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now).changes;
}
