import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/auth/request";
import { getSiteSettings, updateSiteSettings, type SearchEngineName, type ThemeMode, type ThemePreset, type StartDensity, type SiteSettings } from "@/lib/settings/repository";

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
    const input: Partial<SiteSettings> = {};
    for (const key of stringKeys) {
      if (body[key] !== undefined) input[key] = String(body[key]);
    }
    if (body.startPublic !== undefined) input.startPublic = body.startPublic === true;
    if (body.defaultSearchEngine !== undefined) input.defaultSearchEngine = String(body.defaultSearchEngine) as SearchEngineName;
    if (body.themeMode !== undefined) input.themeMode = String(body.themeMode) as ThemeMode;
    if (body.themePreset !== undefined) input.themePreset = String(body.themePreset) as ThemePreset;
    if (body.startDensity !== undefined) input.startDensity = String(body.startDensity) as StartDensity;
    if (typeof body.startCardOpacity === "number") input.startCardOpacity = body.startCardOpacity;
    if (typeof body.startCardRadius === "number") input.startCardRadius = body.startCardRadius;
    if (typeof body.startBackgroundDim === "number") input.startBackgroundDim = body.startBackgroundDim;
    if (Array.isArray(body.socialLinks)) input.socialLinks = body.socialLinks as SiteSettings["socialLinks"];
    if (Array.isArray(body.homeEntries)) input.homeEntries = body.homeEntries as SiteSettings["homeEntries"];
    if (Array.isArray(body.projects)) input.projects = body.projects as SiteSettings["projects"];

    return NextResponse.json({ ok: true, settings: updateSiteSettings(input) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "settings_failed" }, { status: 400 });
  }
}
