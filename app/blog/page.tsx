import Link from "next/link";
import { archiveCounts, filterPublishedPosts, listTaxonomy } from "@/lib/blog/repository";
import { getSiteSettings } from "@/lib/settings/repository";
import { themeClass } from "@/lib/settings/theme";

export const runtime = "nodejs";

type BlogPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: number | null) {
  if (!value) return "未发布";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const params = await searchParams;
  const query = first(params.q) ?? "";
  const tag = first(params.tag) ?? "";
  const category = first(params.category) ?? "";
  const posts = filterPublishedPosts({ query, tag, category, limit: 30 });
  const taxonomy = listTaxonomy();
  const archives = archiveCounts();
  const settings = getSiteSettings();

  return (
    <main className={"paper-page " + themeClass(settings)}>
      <header className="public-header">
        <Link href="/" className="public-brand">know_me / blog</Link>
        <nav className="public-nav">
          <Link href="/blog">文章</Link>
          <a href="#archive">归档</a>
          <a href="#taxonomy">标签</a>
          <Link href="/">主页</Link>
        </nav>
      </header>

      <section className="blog-layout">
        <div>
          <div className="blog-hero">
            <div className="eyebrow">Writing & Notes</div>
            <h1>{query || tag || category ? "找到值得回看的内容。" : "写下值得留下的东西。"}</h1>
            <p>
              {query ? "搜索：" + query : tag ? "标签：" + tag : category ? "分类：" + category :
                "技术、项目、生活与长期笔记。重点不是更新频率，而是以后还能快速找到并读懂。"}
            </p>
          </div>

          <form action="/blog" method="get">
            <input className="blog-search" name="q" defaultValue={query} placeholder="搜索文章、标签或关键词…" aria-label="搜索博客" />
          </form>

          <div className="post-list">
            {posts.map((post, index) => (
              <Link className="post-row" href={"/blog/" + encodeURIComponent(post.slug)} key={post.id}>
                <div>
                  <div className="meta">
                    {formatDate(post.publishedAt)} · {post.tags[0] ? "#" + post.tags[0] : "文章"}
                    {post.pinned ? " · 置顶" : ""}
                  </div>
                  <h2>{post.title}</h2>
                  <p>{post.excerpt}</p>
                  {post.categories.length ? (
                    <div className="post-taxonomy">{post.categories.map((name) => <span key={name}>{name}</span>)}</div>
                  ) : null}
                </div>
                <div
                  className="post-cover"
                  style={index % 3 === 1 ? { background: "linear-gradient(135deg,#ffd9bc,#d99c87,#6a779b)" } :
                    index % 3 === 2 ? { background: "linear-gradient(135deg,#b7e4ce,#80a8b8,#536a86)" } : undefined}
                />
              </Link>
            ))}
            {posts.length === 0 ? (
              <div className="blog-empty">
                <h2>{query || tag || category ? "没有找到匹配文章" : "还没有发布文章"}</h2>
                <p>{query || tag || category ? "换一个关键词或清除筛选后再试。" : "登录管理后台写下第一篇 Markdown 文章。"}</p>
                {(query || tag || category) ? <Link href="/blog">清除筛选</Link> : <Link href="/admin/posts/new">写文章</Link>}
              </div>
            ) : null}
          </div>
        </div>

        <aside id="taxonomy">
          <div className="sidebar-card">
            <strong>标签</strong>
            <div>
              {taxonomy.tags.map((name) => (
                <Link className="tag" key={name} href={"/blog?tag=" + encodeURIComponent(name)}>{name}</Link>
              ))}
              {taxonomy.tags.length === 0 ? <p>暂无标签</p> : null}
            </div>
          </div>
          <div className="sidebar-card">
            <strong>分类</strong>
            <div>
              {taxonomy.categories.map((name) => (
                <Link className="tag" key={name} href={"/blog?category=" + encodeURIComponent(name)}>{name}</Link>
              ))}
              {taxonomy.categories.length === 0 ? <p>暂无分类</p> : null}
            </div>
          </div>
          <div className="sidebar-card" id="archive">
            <strong>归档</strong>
            {archives.map((item) => <p key={item.year}>{item.year} · {item.count} 篇</p>)}
            {archives.length === 0 ? <p>暂无文章</p> : null}
          </div>
          <div className="sidebar-card">
            <strong>订阅</strong>
            <p>RSS 将在后续收尾阶段启用。</p>
          </div>
        </aside>
      </section>
    </main>
  );
}
