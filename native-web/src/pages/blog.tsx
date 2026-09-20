import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { requestJSON } from "../api";
import { contentStats } from "../content";
import { MarkdownRenderer, tableOfContents } from "../markdown";
import type { PostRecord, SessionUser, SiteSettings } from "../types";
import { ErrorCard, LoadingCard, PageFrame } from "../ui";

type PublicList = {
  posts: PostRecord[];
  archives: Array<{ year: string; count: number }>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type Taxonomy = { tags: string[]; categories: string[] };
type FilterKey = "query" | "tag" | "category" | "year";
type Neighbors = { previous: PostRecord | null; next: PostRecord | null };

function dateText(value: number | null) {
  if (!value) return "未发布";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

function buildBlogURL(
  current: Record<FilterKey, string>,
  overrides: Partial<Record<FilterKey, string | null>> = {}
) {
  const merged = { ...current, ...overrides };
  const search = new URLSearchParams();
  (Object.keys(merged) as FilterKey[]).forEach((key) => {
    const value = merged[key]?.trim();
    if (value) search.set(key, value);
  });
  return "/blog" + (search.size ? "?" + search.toString() : "");
}

function usePageMeta(title: string, description?: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const touched: Array<{ element: HTMLMetaElement; previous: string | null; created: boolean }> = [];
    const setMeta = (selector: string, attribute: "name" | "property", key: string, value: string) => {
      let element = document.head.querySelector<HTMLMetaElement>(selector);
      const created = !element;
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attribute, key);
        document.head.appendChild(element);
      }
      touched.push({ element, previous: element.getAttribute("content"), created });
      element.setAttribute("content", value);
    };

    if (description) {
      setMeta('meta[name="description"]', "name", "description", description);
      setMeta('meta[property="og:description"]', "property", "og:description", description);
    }
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    const canonicalURL = window.location.origin + window.location.pathname;
    setMeta('meta[property="og:url"]', "property", "og:url", canonicalURL);
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const canonicalCreated = !canonical;
    const previousCanonical = canonical?.getAttribute("href") ?? null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalURL;

    return () => {
      document.title = previousTitle;
      touched.forEach(({ element, previous, created }) => {
        if (created) element.remove();
        else if (previous == null) element.removeAttribute("content");
        else element.setAttribute("content", previous);
      });
      if (canonicalCreated) canonical?.remove();
      else if (canonical && previousCanonical == null) canonical.removeAttribute("href");
      else if (canonical && previousCanonical != null) canonical.setAttribute("href", previousCanonical);
    };
  }, [description, title]);
}

export function BlogIndexPage({ settings, user }: { settings: SiteSettings; user: SessionUser | null }) {
  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get("query") ?? "";
  const tag = params.get("tag") ?? "";
  const category = params.get("category") ?? "";
  const year = params.get("year") ?? "";
  const page = Math.max(1, Number(params.get("page") || "1") || 1);
  const currentFilters = { query: initialQuery, tag, category, year };
  const [query, setQuery] = useState(initialQuery);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [data, setData] = useState<PublicList | null>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ tags: [], categories: [] });
  const [error, setError] = useState("");

  usePageMeta("Blog · " + (settings.profileName || "Know Me"), settings.profileTagline || "文章与笔记");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== "f") return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const search = new URLSearchParams();
    if (initialQuery) search.set("query", initialQuery);
    if (tag) search.set("tag", tag);
    if (category) search.set("category", category);
    if (year) search.set("year", year);
    if (page > 1) search.set("page", String(page));
    search.set("summary", "1");
    void Promise.all([
      requestJSON<PublicList>("/api/blog/posts?" + search.toString()),
      requestJSON<Taxonomy>("/api/blog/taxonomy")
    ]).then(([posts, tax]) => {
      setData(posts);
      setTaxonomy(tax);
      if (posts.page !== page) {
        const corrected = new URLSearchParams(window.location.search);
        if (posts.page > 1) corrected.set("page", String(posts.page));
        else corrected.delete("page");
        const queryString = corrected.toString();
        window.history.replaceState({}, "", "/blog" + (queryString ? "?" + queryString : ""));
      }
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "blog_failed"));
  }, [category, initialQuery, page, tag, year]);

  function href(overrides: Partial<Record<FilterKey, string | null>> = {}, targetPage = 1) {
    const base = buildBlogURL(currentFilters, overrides);
    if (targetPage <= 1) return base;
    return base + (base.includes("?") ? "&" : "?") + "page=" + targetPage;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    window.location.href = href({ query: query.trim() || null });
  }

  const activeFilters = [
    initialQuery ? { key: "query" as const, label: "搜索：" + initialQuery } : null,
    category ? { key: "category" as const, label: "分类：" + category } : null,
    tag ? { key: "tag" as const, label: "标签：" + tag } : null,
    year ? { key: "year" as const, label: "年份：" + year } : null
  ].filter(Boolean) as Array<{ key: FilterKey; label: string }>;

  return (
    <PageFrame settings={settings} user={user} className="km-blog-page">
      <section className="km-blog-hero">
        <div>
          <span className="km-eyebrow">BLOG</span>
          <h1>文章与笔记</h1>
          <p>写下值得留下的内容，也让以后能够重新找到。</p>
        </div>
        <form onSubmit={submit} className="km-blog-search">
          <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文章…" />
          <button className="dk-button dk-button-primary">搜索</button>
        </form>
      </section>

      {activeFilters.length ? (
        <div className="km-blog-active-filters">
          <span>当前筛选</span>
          {activeFilters.map((item) => (
            <a key={item.key} href={href({ [item.key]: null })} title={"清除" + item.label}>{item.label}<b>×</b></a>
          ))}
          <a className="is-clear" href="/blog">清除全部</a>
        </div>
      ) : null}

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
                  {post.categories.map((item) => <a key={"c-" + item} href={href({ category: item })}>#{item}</a>)}
                  {post.tags.map((item) => <a key={"t-" + item} href={href({ tag: item })}>{item}</a>)}
                </div>
              </article>
            ))}
            {!data.posts.length ? (
              <section className="km-panel km-empty">
                <strong>没有找到文章</strong>
                <p>可以减少筛选条件或清除全部筛选。</p>
                <a className="dk-button" href="/blog">清除筛选</a>
              </section>
            ) : null}
            {data.totalPages > 1 ? (
              <nav className="km-blog-pagination" aria-label="文章分页">
                <a className={data.page <= 1 ? "is-disabled" : ""} href={data.page <= 1 ? undefined : href({}, data.page - 1)}>← 上一页</a>
                <span>第 {data.page} / {data.totalPages} 页 · {data.total} 篇</span>
                <a className={data.page >= data.totalPages ? "is-disabled" : ""} href={data.page >= data.totalPages ? undefined : href({}, data.page + 1)}>下一页 →</a>
              </nav>
            ) : null}
          </section>

          <aside className="km-blog-aside">
            <section className="km-panel">
              <span className="km-eyebrow">CATEGORIES</span>
              <div className="km-filter-list">
                {taxonomy.categories.map((item) => <a key={item} className={item === category ? "is-active" : ""} href={href({ category: item === category ? null : item })}>{item}</a>)}
                {!taxonomy.categories.length ? <small>暂无分类</small> : null}
              </div>
            </section>
            <section className="km-panel">
              <span className="km-eyebrow">TAGS</span>
              <div className="km-chip-row">
                {taxonomy.tags.map((item) => <a key={item} className={item === tag ? "is-active" : ""} href={href({ tag: item === tag ? null : item })}>{item}</a>)}
              </div>
            </section>
            <section className="km-panel">
              <span className="km-eyebrow">ARCHIVE</span>
              <div className="km-filter-list">
                {data.archives.map((item) => (
                  <a key={item.year} className={item.year === year ? "is-active" : ""} href={href({ year: item.year === year ? null : item.year })}>
                    {item.year}<b>{item.count}</b>
                  </a>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}
    </PageFrame>
  );
}

export function BlogPostPage({ settings, user, slug }: { settings: SiteSettings; user: SessionUser | null; slug: string }) {
  const [post, setPost] = useState<PostRecord | null>(null);
  const [neighbors, setNeighbors] = useState<Neighbors>({ previous: null, next: null });
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([
      requestJSON<{ post: PostRecord }>("/api/blog/posts/" + encodeURIComponent(slug)),
      requestJSON<Neighbors>("/api/blog/posts/" + encodeURIComponent(slug) + "/neighbors")
    ])
      .then(([payload, neighborPayload]) => {
        setPost(payload.post);
        setNeighbors(neighborPayload);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "blog_failed"));
  }, [slug]);

  const stats = useMemo(() => contentStats(post?.contentMd ?? ""), [post?.contentMd]);
  const toc = useMemo(() => tableOfContents(post?.contentMd ?? "", post?.title), [post?.contentMd, post?.title]);
  usePageMeta(
    post ? post.title + " · " + (settings.profileName || "Know Me") : "Blog · " + (settings.profileName || "Know Me"),
    post?.seoDescription || post?.excerpt || settings.profileTagline
  );

  return (
    <PageFrame settings={settings} user={user} className="km-blog-page">
      {error ? <ErrorCard message={error === "not_found" ? "文章不存在或尚未发布。" : error} /> : !post ? <LoadingCard text="正在读取文章…" /> : (
        <div className={"km-article-layout" + (toc.length ? " has-toc" : "")}>
          <article className="km-panel km-article">
            <a className="km-back-link" href="/blog">← 返回 Blog</a>
            <header className="km-article-head">
              <span className="km-eyebrow">{post.categories[0] || "ARTICLE"}</span>
              <h1>{post.title}</h1>
              <p>{post.excerpt}</p>
              <div className="km-post-meta">
                <time>首次发布 {dateText(post.firstPublishedAt ?? post.publishedAt)}</time>
                <span>最后编辑 {dateText(post.updatedAt)}</span>
                <span>{stats.readingMinutes} 分钟阅读</span>
                <span>{stats.totalCharacters} 字符</span>
              </div>
            </header>
            {toc.length ? (
              <details className="km-article-toc-mobile">
                <summary>文章目录 · {toc.length}</summary>
                <nav>{toc.map((item) => <a key={item.id} className={"is-h" + item.level} href={"#" + item.id}>{item.text}</a>)}</nav>
              </details>
            ) : null}
            <div className="km-markdown">
              <MarkdownRenderer source={post.contentMd} documentTitle={post.title} />
            </div>
            <footer className="km-article-footer">
              <div className="km-chip-row km-article-tags">
                {post.tags.map((item) => <a key={item} href={"/blog?tag=" + encodeURIComponent(item)}>{item}</a>)}
              </div>
              <nav className="km-article-neighbors" aria-label="相邻文章">
                {neighbors.previous ? <a href={"/blog/" + encodeURIComponent(neighbors.previous.slug)}><span>上一篇</span><strong>{neighbors.previous.title}</strong></a> : <span />}
                {neighbors.next ? <a href={"/blog/" + encodeURIComponent(neighbors.next.slug)}><span>下一篇</span><strong>{neighbors.next.title}</strong></a> : <span />}
              </nav>
            </footer>
          </article>
          {toc.length ? (
            <aside className="km-panel km-article-toc">
              <span className="km-eyebrow">CONTENTS</span>
              <nav>{toc.map((item) => <a key={item.id} className={"is-h" + item.level} href={"#" + item.id}>{item.text}</a>)}</nav>
            </aside>
          ) : null}
        </div>
      )}
    </PageFrame>
  );
}
