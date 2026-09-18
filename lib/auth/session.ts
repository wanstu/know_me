import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cleanupExpiredSessions, getDb } from "@/lib/db";

export const SESSION_COOKIE = "know_me_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  avatar: string;
};

type SessionRow = AuthUser & {
  lastSeenAt: number;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionRecord(userId: number, userAgent = "") {
  cleanupExpiredSessions();

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  getDb().prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at, user_agent_hint) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(randomUUID(), userId, tokenHash, expiresAt, now, now, userAgent.slice(0, 240));

  return { token, expiresAt };
}

export function deleteSessionToken(token: string) {
  if (!token) return;
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function sessionCookieOptions(expiresAt?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(expiresAt ? { expires: new Date(expiresAt) } : {})
  };
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const now = Date.now();
  const row = getDb().prepare(
    "SELECT users.id AS id, users.username AS username, users.display_name AS displayName, users.avatar AS avatar, sessions.last_seen_at AS lastSeenAt FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? LIMIT 1"
  ).get(hashToken(token), now) as SessionRow | undefined;

  if (!row) return null;

  if (now - row.lastSeenAt > 5 * 60 * 1000) {
    getDb().prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(now, hashToken(token));
  }

  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatar: row.avatar
  };
}

export async function requireUser(nextPath = "/admin") {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}
