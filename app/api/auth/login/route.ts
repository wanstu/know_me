import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionRecord, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { isSameOriginRequest, safeNextPath } from "@/lib/auth/request";

export const runtime = "nodejs";

type UserRow = { id: number; passwordHash: string };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const nextPath = safeNextPath(String(form.get("next") ?? ""), "/admin");

  const row = getDb().prepare(
    "SELECT id, password_hash AS passwordHash FROM users WHERE username = ? LIMIT 1"
  ).get(username) as UserRow | undefined;

  const valid = row ? await verifyPassword(password, row.passwordHash) : false;
  if (!row || !valid) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "invalid_credentials");
    url.searchParams.set("next", nextPath);
    return NextResponse.redirect(url, 303);
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  const session = createSessionRecord(row.id, userAgent);
  const response = NextResponse.redirect(new URL(nextPath, request.url), 303);
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return response;
}
