import Link from "next/link";
import { demoPosts } from "@/lib/demo-data";

export default function BlogPage() {
  return (
    <main className="paper-page">
      <header className="public-header">
        <Link href="/" className="public-brand">know_me / blog</Link>
        <nav className="public-nav">
          <Link href="/blog">文章</Link>
          <a href="#">归档</a>
          <a href="#">标签</a>
          <Link href="/">主页</Link>
        </nav>
      </header>

      <section className="blog-layout">
        <div>
          <div className="blog-hero">
            <div className="eyebrow" style={{ color: "#778395" }}>Writing & Notes</div>
            <h1>写下值得留下的东西。</h1>
            <p>技术、项目、生活与长期笔记。重点不是更新频率，而是以后还能快速找到并读懂。</p>
          </div>

          <input className="blog-search" placeholder="搜索文章、标签或关键词…" aria-label="搜索博客" />

          <div className="post-list">
            {demoPosts.map((post, index) => (
              <Link className="post-row" href={"/blog/" + post.slug} key={post.slug}>
                <div>
                  <div className="meta">{post.date} · {post.reading} · #{post.tag}</div>
                  <h2>{post.title}</h2>
                  <p>{post.excerpt}</p>
                </div>
                <div
                  className="post-cover"
                  style={index === 1 ? { background: "linear-gradient(135deg,#ffd9bc,#d99c87,#6a779b)" } :
                    index === 2 ? { background: "linear-gradient(135deg,#b7e4ce,#80a8b8,#536a86)" } : undefined}
                />
              </Link>
            ))}
          </div>
        </div>

        <aside>
          <div className="sidebar-card">
            <strong>标签</strong>
            <div>
              {["开发", "Markdown", "项目", "生活", "随笔"].map((tag) => (
                <span className="tag" key={tag}>{tag}</span>
              ))}
            </div>
          </div>
          <div className="sidebar-card">
            <strong>归档</strong>
            <p>2026 · 18 篇</p>
            <p>2025 · 31 篇</p>
          </div>
          <div className="sidebar-card">
            <strong>订阅</strong>
            <p>RSS / Atom</p>
          </div>
        </aside>
      </section>
    </main>
  );
}
