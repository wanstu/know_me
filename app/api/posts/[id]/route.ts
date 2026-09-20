import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/auth/request";
import { deletePost, getPostById, savePost, type PostStatus } from "@/lib/blog/repository";

export const runtime = "nodejs";

type RouteProps = { params: Promise<{ id: string }> };

function parseId(value: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("invalid_id");
  return id;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function status(value: unknown): PostStatus {
  return value === "published" || value === "scheduled" ? value : "draft";
}

export async function GET(_request: NextRequest, { params }: RouteProps) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const post = getPostById(parseId((await params).id));
  if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ post });
}

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const id = parseId((await params).id);
    const body = await request.json() as Record<string, unknown>;
    const post = savePost({
      title: String(body.title ?? ""),
      slug: String(body.slug ?? ""),
      excerpt: String(body.excerpt ?? ""),
      contentMd: String(body.contentMd ?? ""),
      status: status(body.status),
      pinned: body.pinned === true,
      seoTitle: String(body.seoTitle ?? ""),
      seoDescription: String(body.seoDescription ?? ""),
      publishedAt: typeof body.publishedAt === "number" ? body.publishedAt : null,
      firstPublishedAt: typeof body.firstPublishedAt === "number" ? body.firstPublishedAt : null,
      tags: strings(body.tags),
      categories: strings(body.categories)
    }, id);
    return NextResponse.json({ ok: true, post });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "save_failed" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteProps) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    deletePost(parseId((await params).id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "delete_failed" }, { status: 400 });
  }
}
