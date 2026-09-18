import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/auth/request";
import { listMedia, saveMedia } from "@/lib/media/repository";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ media: listMedia() });
}

export async function POST(request: NextRequest) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "file_required" }, { status: 400 });
    const alt = String(form.get("alt") ?? "");
    const media = saveMedia(file, new Uint8Array(await file.arrayBuffer()), alt);
    return NextResponse.json({ ok: true, media });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "upload_failed" }, { status: 400 });
  }
}
