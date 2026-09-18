import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionRecord, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { isSameOriginRequest, safeNextPath } from "@/lib/auth/request";
import { checkLoginRateLimit, clearLoginFailures, recordLoginFailure } from "@/lib/auth/rate-limit";

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
  const rateLimit = checkLoginRateLimit(request, username);
  if (!rateLimit.allowed) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "rate_limited");
    url.searchParams.set("retry", String(rateLimit.retryAfterSeconds));
    url.searchParams.set("next", nextPath);
    return NextResponse.redirect(url, 303);
  }

  const row = getDb().prepare(
    "SELECT id, password_hash AS passwordHash FROM users WHERE username = ? LIMIT 1"
  ).get(username) as UserRow | undefined;

  const valid = row ? await verifyPassword(password, row.passwordHash) : false;
  if (!row || !valid) {
    recordLoginFailure(request, username);
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "invalid_credentials");
    url.searchParams.set("next", nextPath);
    return NextResponse.redirect(url, 303);
  }

  clearLoginFailures(request, username);
  const userAgent = request.headers.get("user-agent") ?? "";
  const session = createSessionRecord(row.id, userAgent);
  const response = NextResponse.redirect(new URL(nextPath, request.url), 303);
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return response;
}
