import { getDb } from "../lib/db";

const db = getDb();
const rows = db.prepare("SELECT id, applied_at AS appliedAt FROM schema_migrations ORDER BY id").all();
console.log("Database ready.");
for (const row of rows as Array<{ id: string; appliedAt: number }>) {
  console.log(`- ${row.id} @ ${new Date(row.appliedAt).toISOString()}`);
}
