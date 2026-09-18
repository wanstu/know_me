import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/auth/request";
import { listPostRevisions, restorePostRevision } from "@/lib/blog/repository";

export const runtime = "nodejs";

type RouteProps = { params: Promise<{ id: string }> };

function parseId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("invalid_id");
  return id;
}

export async function GET(_request: NextRequest, { params }: RouteProps) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const id = parseId((await params).id);
    return NextResponse.json({ revisions: listPostRevisions(id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid_request" }, { status: 400 });
  }
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const id = parseId((await params).id);
    const body = await request.json() as { revisionId?: unknown };
    const revisionId = parseId(String(body.revisionId ?? ""));
    const post = restorePostRevision(id, revisionId);
    return NextResponse.json({ ok: true, post, revisions: listPostRevisions(id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "restore_failed" }, { status: 400 });
  }
}
