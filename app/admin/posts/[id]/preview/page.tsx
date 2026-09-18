import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownRenderer } from "@/components/blog/markdown-renderer";
import { extractToc } from "@/lib/blog/toc";
import { getPostById, markdownToText } from "@/lib/blog/repository";
import { getSiteSettings } from "@/lib/settings/repository";
import { themeClass } from "@/lib/settings/theme";

export const runtime = "nodejs";

export default async function PostPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const post = getPostById(id);
  if (!post) notFound();

  const toc = extractToc(post.contentMd);
  const minutes = Math.max(1, Math.ceil(markdownToText(post.contentMd).length / 500));
  const settings = getSiteSettings();

  return (
    <main className={"paper-page " + themeClass(settings)}>
      <header className="public-header editor-preview-header">
        <div className="public-brand">know_me / preview</div>
        <nav className="public-nav">
          <span className={"post-status post-status--" + post.status}>
            {post.status === "published" ? "已发布" : post.status === "scheduled" ? "定时" : "草稿"}
          </span>
          <Link href={"/admin/posts/" + post.id}>← 返回编辑</Link>
          {post.status === "published" ? <Link href={"/blog/" + encodeURIComponent(post.slug)} target="_blank">公开页面 ↗</Link> : null}
        </nav>
      </header>

      <section className="article-layout">
        <article className="article">
          <div className="editor-preview-notice">这是管理端预览，不受文章发布状态限制。</div>
          <div className="eyebrow">
            {post.categories[0] || post.tags[0] || "Preview"}
          </div>
          <h1>{post.title}</h1>
          <div className="article-meta">阅读约 {minutes} 分钟 · /{post.slug}</div>
          <MarkdownRenderer content={post.contentMd} />
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
