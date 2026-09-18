import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/auth/request";
import { previewItabImport } from "@/lib/navigation/itab";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const body = await request.json() as { raw?: unknown };
    const raw = typeof body.raw === "string" ? body.raw : "";
    if (!raw) return NextResponse.json({ error: "empty_file" }, { status: 400 });
    if (Buffer.byteLength(raw, "utf8") > 5 * 1024 * 1024) return NextResponse.json({ error: "itab_file_too_large" }, { status: 413 });
    return NextResponse.json({ ok: true, preview: previewItabImport(raw) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid_itab" }, { status: 400 });
  }
}
