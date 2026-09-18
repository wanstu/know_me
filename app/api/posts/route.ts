import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSameOriginRequest } from "@/lib/auth/request";
import { listAdminPosts, savePost, type PostStatus } from "@/lib/blog/repository";

export const runtime = "nodejs";

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function status(value: unknown): PostStatus {
  return value === "published" || value === "scheduled" ? value : "draft";
}

export async function GET() {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ posts: listAdminPosts() });
}

export async function POST(request: NextRequest) {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
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
      tags: strings(body.tags),
      categories: strings(body.categories)
    });
    return NextResponse.json({ ok: true, post });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "save_failed" }, { status: 400 });
  }
}
