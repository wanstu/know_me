import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/auth/request";
import { applyItabImport } from "@/lib/navigation/itab";
import { getNavigationTree } from "@/lib/navigation/repository";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const body = await request.json() as { raw?: unknown; strategy?: unknown; overwrite?: unknown };
    const raw = typeof body.raw === "string" ? body.raw : "";
    if (!raw) return NextResponse.json({ error: "empty_file" }, { status: 400 });
    const strategy = body.strategy === "replace" ? "replace" : "merge";
    const overwrite = body.overwrite === true;
    const result = applyItabImport(raw, strategy, overwrite);
    return NextResponse.json({ ok: true, result, tree: getNavigationTree(true) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid_itab" }, { status: 400 });
  }
}
