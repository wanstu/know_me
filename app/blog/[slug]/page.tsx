import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownRenderer } from "@/components/blog/markdown-renderer";
import { extractToc } from "@/lib/blog/toc";
import { getAdjacentPublishedPosts, getPublishedPostBySlug, markdownToText } from "@/lib/blog/repository";

export const runtime = "nodejs";

type ArticlePageProps = {
  params: Promise<{ slug: string }>;
};

function formatDate(value: number | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPublishedPostBySlug(decodeURIComponent(slug));
  if (!post) return { title: "文章不存在" };
  return {
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt,
    openGraph: {
      title: post.seoTitle || post.title,
      description: post.seoDescription || post.excerpt,
      type: "article",
      publishedTime: post.publishedAt ? new Date(post.publishedAt).toISOString() : undefined
    }
  };
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const post = getPublishedPostBySlug(decodeURIComponent(slug));
  if (!post) notFound();

  const toc = extractToc(post.contentMd);
  const adjacent = getAdjacentPublishedPosts(post.id);
  const minutes = Math.max(1, Math.ceil(markdownToText(post.contentMd).length / 500));

  return (
    <main className="paper-page">
      <header className="public-header">
        <Link href="/" className="public-brand">know_me / blog</Link>
        <nav className="public-nav">
          <Link href="/blog">← 返回文章</Link>
          <Link href="/">主页</Link>
        </nav>
      </header>

      <section className="article-layout">
        <article className="article">
          <div className="eyebrow" style={{ color: "#778395" }}>
            {post.categories[0] || post.tags[0] || "Article"}
          </div>
          <h1>{post.title}</h1>
          <div className="article-meta">
            {formatDate(post.publishedAt)} · 阅读约 {minutes} 分钟
            {post.updatedAt > (post.publishedAt ?? 0) ? " · 更新于 " + formatDate(post.updatedAt) : ""}
          </div>

          <MarkdownRenderer content={post.contentMd} />

          <footer className="article-footer">
            {post.tags.length ? (
              <div className="article-tags">
                {post.tags.map((tag) => <Link key={tag} href={"/blog?tag=" + encodeURIComponent(tag)}>#{tag}</Link>)}
              </div>
            ) : null}
            <div className="article-adjacent">
              {adjacent.older ? <Link href={"/blog/" + encodeURIComponent(adjacent.older.slug)}>← {adjacent.older.title}</Link> : <span />}
              {adjacent.newer ? <Link href={"/blog/" + encodeURIComponent(adjacent.newer.slug)}>{adjacent.newer.title} →</Link> : <span />}
            </div>
          </footer>
        </article>

        <aside className="article-toc">
          <strong>本文目录</strong>
          {toc.map((item) => (
            <a key={item.id} href={"#" + item.id} style={{ paddingLeft: Math.max(0, item.level - 2) * 12 }}>
              {item.text}
            </a>
          ))}
          {toc.length === 0 ? <span className="toc-empty">本文没有二级标题</span> : null}
        </aside>
      </section>
    </main>
  );
}
