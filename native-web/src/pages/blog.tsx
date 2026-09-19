import { FormEvent, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import { requestJSON } from "../api";
import type { PostRecord, SiteSettings } from "../types";
import { ErrorCard, LoadingCard, PageFrame } from "../ui";

type PublicList = {
  posts: PostRecord[];
  archives: Array<{ year: string; count: number }>;
};

type Taxonomy = { tags: string[]; categories: string[] };

function dateText(value: number | null) {
  if (!value) return "未发布";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

export function BlogIndexPage({ settings }: { settings: SiteSettings }) {
  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get("query") ?? "";
  const tag = params.get("tag") ?? "";
  const category = params.get("category") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [data, setData] = useState<PublicList | null>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ tags: [], categories: [] });
  const [error, setError] = useState("");

  useEffect(() => {
    const search = new URLSearchParams();
    if (initialQuery) search.set("query", initialQuery);
    if (tag) search.set("tag", tag);
    if (category) search.set("category", category);
    void Promise.all([
      requestJSON<PublicList>("/api/blog/posts?" + search.toString()),
      requestJSON<Taxonomy>("/api/blog/taxonomy")
    ]).then(([posts, tax]) => {
      setData(posts);
      setTaxonomy(tax);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "blog_failed"));
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const search = new URLSearchParams();
    if (query.trim()) search.set("query", query.trim());
    window.location.href = "/blog" + (search.size ? "?" + search.toString() : "");
  }

  return (
    <PageFrame settings={settings} className="km-blog-page">
      <section className="km-blog-hero">
        <div>
          <span className="km-eyebrow">BLOG</span>
          <h1>文章与笔记</h1>
          <p>写下值得留下的内容，也让以后能够重新找到。</p>
        </div>
        <form onSubmit={submit} className="km-blog-search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文章…" />
          <button className="dk-button dk-button-primary">搜索</button>
        </form>
      </section>

      {error ? <ErrorCard message={error} /> : !data ? <LoadingCard text="正在读取文章…" /> : (
        <div className="km-blog-layout">
          <section className="km-blog-list">
            {data.posts.map((post) => (
              <article className="km-panel km-post-card" key={post.id}>
                <div className="km-post-meta">
                  {post.pinned ? <span>置顶</span> : null}
                  <time>{dateText(post.publishedAt)}</time>
                </div>
                <h2><a href={"/blog/" + encodeURIComponent(post.slug)}>{post.title}</a></h2>
                <p>{post.excerpt}</p>
                <div className="km-chip-row">
                  {post.categories.map((item) => <a key={"c-" + item} href={"/blog?category=" + encodeURIComponent(item)}>#{item}</a>)}
                  {post.tags.map((item) => <a key={"t-" + item} href={"/blog?tag=" + encodeURIComponent(item)}>{item}</a>)}
                </div>
              </article>
            ))}
            {!data.posts.length ? <section className="km-panel km-empty">没有找到文章。</section> : null}
          </section>

          <aside className="km-blog-aside">
            <section className="km-panel">
              <span className="km-eyebrow">CATEGORIES</span>
              <div className="km-filter-list">
                {taxonomy.categories.map((item) => <a key={item} className={item === category ? "is-active" : ""} href={"/blog?category=" + encodeURIComponent(item)}>{item}</a>)}
                {!taxonomy.categories.length ? <small>暂无分类</small> : null}
              </div>
            </section>
            <section className="km-panel">
              <span className="km-eyebrow">TAGS</span>
              <div className="km-chip-row">
                {taxonomy.tags.map((item) => <a key={item} className={item === tag ? "is-active" : ""} href={"/blog?tag=" + encodeURIComponent(item)}>{item}</a>)}
              </div>
            </section>
            <section className="km-panel">
              <span className="km-eyebrow">ARCHIVE</span>
              <div className="km-filter-list">
                {data.archives.map((item) => <span key={item.year}>{item.year}<b>{item.count}</b></span>)}
              </div>
            </section>
          </aside>
        </div>
      )}
    </PageFrame>
  );
}

export function BlogPostPage({ settings, slug }: { settings: SiteSettings; slug: string }) {
  const [post, setPost] = useState<PostRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void requestJSON<{ post: PostRecord }>("/api/blog/posts/" + encodeURIComponent(slug))
      .then((payload) => setPost(payload.post))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "blog_failed"));
  }, [slug]);

  return (
    <PageFrame settings={settings} className="km-blog-page">
      {error ? <ErrorCard message={error === "not_found" ? "文章不存在或尚未发布。" : error} /> : !post ? <LoadingCard text="正在读取文章…" /> : (
        <article className="km-panel km-article">
          <a className="km-back-link" href="/blog">← 返回 Blog</a>
          <header className="km-article-head">
            <span className="km-eyebrow">{post.categories[0] || "ARTICLE"}</span>
            <h1>{post.title}</h1>
            <p>{post.excerpt}</p>
            <div className="km-post-meta"><time>{dateText(post.publishedAt)}</time><span>{Math.max(1, Math.ceil(post.contentMd.length / 900))} 分钟阅读</span></div>
          </header>
          <div className="km-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug, rehypeHighlight]}>
              {post.contentMd}
            </ReactMarkdown>
          </div>
          <footer className="km-chip-row km-article-tags">
            {post.tags.map((item) => <a key={item} href={"/blog?tag=" + encodeURIComponent(item)}>{item}</a>)}
          </footer>
        </article>
      )}
    </PageFrame>
  );
}
