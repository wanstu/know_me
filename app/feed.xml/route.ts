import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getSiteSettings } from "@/lib/settings/repository";
import { allowsVisibility, routeAllowed } from "@/lib/settings/access";
import { listPublishedPosts } from "@/lib/blog/repository";
import { getSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const settings = getSiteSettings();
  const user = await getSessionUser();
  const loggedIn = Boolean(user);
  if (!routeAllowed(settings.routeAccess, "/feed.xml", loggedIn)) {
    const denied = allowsVisibility(settings.routeAccess["/feed.xml"], loggedIn)
      ? settings.routeAccess["/blog"] : settings.routeAccess["/feed.xml"];
    const status = denied === "disabled" ? 404 : denied === "authenticated" && !loggedIn ? 401 : 403;
    return new NextResponse("feed_unavailable", { status, headers: { "cache-control": "private, no-store" } });
  }
  const base = getSiteUrl();
  const posts = listPublishedPosts("", 50);
  const items = posts.map((post) => {
    const url = base + "/blog/" + encodeURIComponent(post.slug);
    const date = new Date(post.publishedAt ?? post.updatedAt).toUTCString();
    return [
      "<item>",
      "<title>" + escapeXml(post.title) + "</title>",
      "<link>" + escapeXml(url) + "</link>",
      "<guid>" + escapeXml(url) + "</guid>",
      "<pubDate>" + date + "</pubDate>",
      "<description>" + escapeXml(post.excerpt) + "</description>",
      "</item>"
    ].join("");
  }).join("");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    "<title>know_me / blog</title>",
    "<link>" + escapeXml(base + "/blog") + "</link>",
    "<description>个人博客文章与笔记</description>",
    "<language>zh-CN</language>",
    items,
    "</channel>",
    "</rss>"
  ].join("");

  return new NextResponse(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "private, no-store"
    }
  });
}
