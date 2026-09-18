import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/auth/request";
import { deleteMedia } from "@/lib/media/repository";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  return NextResponse.json({ ok: deleteMedia(id) });
}
