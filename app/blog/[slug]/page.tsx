import Link from "next/link";
import { notFound } from "next/navigation";
import { demoPosts } from "@/lib/demo-data";

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = demoPosts.find((item) => item.slug === slug);
  if (!post) notFound();

  const codeSample = 'export type PostStatus =\n  | "draft"\n  | "published"\n  | "scheduled";';

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
          <div className="eyebrow" style={{ color: "#778395" }}>{post.tag}</div>
          <h1>{post.title}</h1>
          <div className="article-meta">{post.date} · 阅读约 {post.reading}</div>

          <div className="prose">
            <p>
              很多个人网站最开始都只解决一个问题：展示自己。但真正长期使用以后，
              我更希望它同时是每天会打开的工具。
            </p>

            <h2 id="why">为什么要统一</h2>
            <p>
              个人主页负责“我是谁”，博客负责“我写了什么”，起始页负责“我每天去哪”。
              它们的主题、登录、媒体和配置其实可以共享。
            </p>

            <h2 id="markdown">Markdown 仍然是源数据</h2>
            <p>
              文章永远保存原始 Markdown。渲染结果只是缓存，这样以后切换框架时仍然能完整迁移。
            </p>
            <pre><code>{codeSample}</code></pre>

            <h2 id="privacy">起始页不是公开导航站</h2>
            <p>
              导入的导航可能包含本地地址和工作环境，所以默认需要登录，并允许对单个入口设置
              <code>private</code>。
            </p>
          </div>
        </article>

        <aside className="article-toc">
          <strong>本文目录</strong>
          <a href="#why">为什么要统一</a>
          <a href="#markdown">Markdown 仍然是源数据</a>
          <a href="#privacy">起始页不是公开导航站</a>
        </aside>
      </section>
    </main>
  );
}
