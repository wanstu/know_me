import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";

import { normalizeMarkdownForDisplay } from "@/lib/blog/markdown";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: Array.from(new Set([...(defaultSchema.tagNames ?? []), "mark", "sup"]))
};

export function MarkdownRenderer({
  content,
  documentTitle,
  className = "prose"
}: {
  content: string;
  documentTitle?: string;
  className?: string;
}) {
  const markdown = normalizeMarkdownForDisplay(content, documentTitle);
  return (
    <div className={className}>
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
    </div>
  );
}
