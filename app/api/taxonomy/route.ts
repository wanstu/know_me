import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/auth/request";
import {
  createTaxonomy,
  deleteTaxonomy,
  listTaxonomyDetails,
  renameTaxonomy,
  type TaxonomyKind
} from "@/lib/blog/repository";

export const runtime = "nodejs";

function parseKind(value: unknown): TaxonomyKind {
  return value === "category" ? "category" : "tag";
}

function parseId(value: unknown) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("invalid_id");
  return id;
}

export async function GET() {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(listTaxonomyDetails());
}

export async function POST(request: NextRequest) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const kind = parseKind(body.kind);

    if (action === "create") {
      const id = createTaxonomy(kind, String(body.name ?? ""));
      return NextResponse.json({ ok: true, id, ...listTaxonomyDetails() });
    }
    if (action === "rename") {
      renameTaxonomy(kind, parseId(body.id), String(body.name ?? ""));
      return NextResponse.json({ ok: true, ...listTaxonomyDetails() });
    }
    if (action === "delete") {
      deleteTaxonomy(kind, parseId(body.id));
      return NextResponse.json({ ok: true, ...listTaxonomyDetails() });
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "taxonomy_failed" },
      { status: 400 }
    );
  }
}
