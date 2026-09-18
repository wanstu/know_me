import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  return {
    rules: [
      { userAgent: "*", allow: ["/", "/blog", "/media"], disallow: ["/admin", "/api", "/login", "/start"] }
    ],
    sitemap: base + "/sitemap.xml"
  };
}
