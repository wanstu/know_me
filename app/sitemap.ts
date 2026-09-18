import type { MetadataRoute } from "next";
import { listPublishedPosts } from "@/lib/blog/repository";
import { getSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  const staticEntries: MetadataRoute.Sitemap = [
    { url: base + "/", changeFrequency: "weekly", priority: 1 },
    { url: base + "/blog", changeFrequency: "daily", priority: 0.9 }
  ];
  const posts: MetadataRoute.Sitemap = listPublishedPosts("", 500).map((post) => ({
    url: base + "/blog/" + encodeURIComponent(post.slug),
    lastModified: new Date(post.updatedAt),
    changeFrequency: "monthly",
    priority: 0.7
  }));
  return [...staticEntries, ...posts];
}
