import { tableOfContents, type TOCItem } from "@/lib/blog/markdown";

export type TocItem = TOCItem;

export function extractToc(markdown: string, documentTitle?: string): TocItem[] {
  return tableOfContents(markdown, documentTitle);
}
