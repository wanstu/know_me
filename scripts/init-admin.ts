import { randomBytes } from "node:crypto";
import { getDb } from "../lib/db";
import { hashPassword } from "../lib/auth/password";

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const username = (arg("username") ?? process.env.ADMIN_USERNAME ?? "admin").trim();
  const requestedPassword = arg("password") ?? process.env.ADMIN_PASSWORD;
  const generatedPassword = requestedPassword ? null : randomBytes(18).toString("base64url");
  const password = requestedPassword ?? generatedPassword!;
  const displayName = (arg("display-name") ?? process.env.ADMIN_DISPLAY_NAME ?? username).trim();

  if (!username) throw new Error("username_required");
  if (password.length < 10) throw new Error("password_must_be_at_least_10_characters");

  const passwordHash = await hashPassword(password);
  const now = Date.now();
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE username = ? LIMIT 1").get(username) as { id: number } | undefined;

  if (existing) {
    db.prepare("UPDATE users SET password_hash = ?, display_name = ?, updated_at = ? WHERE id = ?")
      .run(passwordHash, displayName, now, existing.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
    console.log(`Updated administrator: ${username}`);
  } else {
    db.prepare("INSERT INTO users (username, password_hash, display_name, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(username, passwordHash, displayName, "", now, now);
    console.log(`Created administrator: ${username}`);
  }

  if (generatedPassword) {
    console.log(`Generated password: ${generatedPassword}`);
    console.log("Store it now; it is not recoverable from the database.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
