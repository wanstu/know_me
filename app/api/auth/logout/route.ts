import { NextResponse } from "next/server";
import { deleteSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/auth/request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const token = request.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  if (token) deleteSessionToken(decodeURIComponent(token));

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), expires: new Date(0) });
  return response;
}
