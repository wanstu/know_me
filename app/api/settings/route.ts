import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/auth/request";
import { getSiteSettings, updateSiteSettings, type SearchEngineName, type ThemeMode } from "@/lib/settings/repository";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ settings: getSiteSettings() });
}

export async function PATCH(request: NextRequest) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const stringKeys = [
      "profileName", "profileTagline", "profileBio", "avatarUrl", "quote", "quoteAuthor",
      "githubUrl", "emailUrl", "aboutUrl", "homeBackgroundUrl", "startBackgroundUrl"
    ] as const;
    const input: Record<string, unknown> = {};
    for (const key of stringKeys) {
      if (body[key] !== undefined) input[key] = String(body[key]);
    }
    if (body.startPublic !== undefined) input.startPublic = body.startPublic === true;
    if (body.defaultSearchEngine !== undefined) input.defaultSearchEngine = String(body.defaultSearchEngine) as SearchEngineName;
    if (body.themeMode !== undefined) input.themeMode = String(body.themeMode) as ThemeMode;

    return NextResponse.json({ ok: true, settings: updateSiteSettings(input) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "settings_failed" }, { status: 400 });
  }
}
