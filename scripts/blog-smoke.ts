import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "../components/blog/markdown-renderer";
import { normalizeMarkdownForDisplay, parseMarkdownImport, tableOfContents } from "../lib/blog/markdown";
import { getDb } from "../lib/db";
import {
  deletePost,
  getPostById,
  getPublishedPostBySlug,
  listPostRevisions,
  listPublishedPosts,
  restorePostRevision,
  savePost
} from "../lib/blog/repository";

const marker = "know-me-smoke-" + Date.now();
const created: number[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const frontMatterSource = "\uFEFF---\r\ntitle: \"数据库系统概念 Day01\"\r\ndate: 2024-06-22 00:00:00\r\n---\r\n# 数据库系统概念 Day01\r\n\r\n## 重复章节\r\n\r\n正文\r\n\r\n## 重复章节\r\n";
const imported = parseMarkdownImport(frontMatterSource, "frontmatter");
assert(imported.title === "数据库系统概念 Day01", "front matter title import failed");
assert(imported.firstPublishedAt === new Date("2024-06-22T00:00:00").getTime(), "front matter date import failed");
assert(!imported.contentMd.includes("title:"), "front matter leaked into imported body");
assert(parseMarkdownImport(frontMatterSource, "plain").contentMd.includes("title:"), "plain import unexpectedly stripped front matter");
assert(!normalizeMarkdownForDisplay(imported.contentMd, imported.title).startsWith("# 数据库系统概念 Day01"), "duplicate article H1 was not removed");
const toc = tableOfContents(imported.contentMd, imported.title);
assert(toc.length === 2 && toc[0].id === "重复章节" && toc[1].id === "重复章节-1", "duplicate heading anchors are unstable");

const richMarkdown = "# Render Smoke\n\n~~删除线~~\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n<mark>重点</mark> H<sup>2</sup>O\n\n$E = mc^2$\n\n```js\nconst answer = 42;\n```";
const rendered = renderToStaticMarkup(createElement(MarkdownRenderer, { content: richMarkdown, documentTitle: "Render Smoke" }));
for (const marker of ["<del>", "<table>", "<mark>重点</mark>", "<sup>2</sup>", "katex", "hljs"]) {
  assert(rendered.includes(marker), "rich Markdown render missing " + marker);
}
assert(!rendered.includes("<h1"), "document title H1 was rendered twice");

try {
  const draft = savePost({
    title: "Smoke Markdown " + marker,
    slug: marker,
    contentMd: "# Smoke\n\nalpha_unique_term\n\n## Section\n\n- one\n- two",
    status: "draft",
    tags: ["smoke", "markdown"],
    categories: ["Test"]
  });
  created.push(draft.id);
  assert(getPublishedPostBySlug(draft.slug) === null, "draft leaked into public lookup");

  const updated = savePost({
    title: draft.title,
    slug: draft.slug,
    contentMd: draft.contentMd + "\n\nrevision text",
    status: "draft",
    tags: draft.tags,
    categories: draft.categories
  }, draft.id);
  assert(updated.contentMd.includes("revision text"), "draft update failed");

  const revisionCount = (getDb().prepare("SELECT COUNT(*) AS count FROM post_revisions WHERE post_id = ?").get(draft.id) as { count: number }).count;
  assert(revisionCount >= 1, "revision was not created");
  const revisionRows = listPostRevisions(draft.id);
  assert(revisionRows.length >= 1, "revision list is empty");
  const restored = restorePostRevision(draft.id, revisionRows[0].id);
  assert(restored.contentMd === draft.contentMd, "revision restore did not restore original content");
  const updatedAgain = savePost({
    title: restored.title,
    slug: restored.slug,
    contentMd: restored.contentMd + "\n\nrevision text",
    status: "draft",
    tags: restored.tags,
    categories: restored.categories
  }, restored.id);

  const published = savePost({
    title: updatedAgain.title,
    slug: updatedAgain.slug,
    contentMd: updatedAgain.contentMd,
    status: "published",
    tags: updatedAgain.tags,
    categories: updatedAgain.categories
  }, updatedAgain.id);
  assert(Boolean(getPublishedPostBySlug(published.slug)), "published post not visible");

  const search = listPublishedPosts("alpha_unique_term", 20);
  assert(search.some((post) => post.id === published.id), "FTS search did not find published post");

  const scheduled = savePost({
    title: "Scheduled " + marker,
    slug: marker + "-scheduled",
    contentMd: "# Scheduled\n\nfuture_unique_term",
    status: "scheduled",
    publishedAt: Date.now() + 60 * 60 * 1000
  });
  created.push(scheduled.id);
  assert(getPublishedPostBySlug(scheduled.slug) === null, "future scheduled post leaked early");

  savePost({
    title: scheduled.title,
    slug: scheduled.slug,
    contentMd: scheduled.contentMd,
    status: "scheduled",
    publishedAt: Date.now() - 1000
  }, scheduled.id);
  assert(Boolean(getPublishedPostBySlug(scheduled.slug)), "elapsed scheduled post was not visible");

  assert(Boolean(getPostById(published.id)), "admin lookup failed");
  console.log("blog smoke: PASS");
  console.log("frontmatter/gfm/html/math/toc verified");
  console.log("draft/revision-restore/publish/search/schedule verified");
} finally {
  for (const id of created) deletePost(id);
}
