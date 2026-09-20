import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

import { normalizeMarkdownForDisplay } from "../../lib/blog/markdown";

export {
  parseFrontMatterDate,
  parseMarkdownImport,
  stripFrontMatter,
  normalizeMarkdownForDisplay,
  tableOfContents,
  type MarkdownImportMode,
  type ParsedMarkdownImport,
  type TOCItem
} from "../../lib/blog/markdown";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: Array.from(new Set([...(defaultSchema.tagNames ?? []), "mark", "sup"]))
};

export function MarkdownRenderer({
  source,
  documentTitle
}: {
  source: string;
  documentTitle?: string;
}) {
  const markdown = useMemo(
    () => normalizeMarkdownForDisplay(source, documentTitle),
    [source, documentTitle]
  );

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        rehypeRaw,
        [rehypeSanitize, sanitizeSchema],
        rehypeSlug,
        rehypeKatex,
        rehypeHighlight
      ]}
    >
      {markdown}
    </ReactMarkdown>
  );
}
