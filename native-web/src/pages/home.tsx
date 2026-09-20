import { useEffect, useMemo, useState } from "react";
import { requestJSON } from "../api";
import type { PostRecord, SessionUser, SiteSettings } from "../types";
import { PageFrame, isExternal, safeHref } from "../ui";

const fallbackQuotes = [
  "把常用的东西放近一点，把重要的事情做深一点。",
  "先让今天变得清楚，再考虑更远的答案。",
  "记录不是为了占满时间，而是为了留下路径。",
  "好工具应该安静地工作，把注意力还给人。",
  "慢一点整理，也比反复寻找更省时间。",
  "把复杂留给系统，把简单留给使用的人。",
  "持续做小而正确的改进，结果会自己累积。",
  "真正顺手的工作流，不需要每天重新学习。",
  "今天写下的一点东西，也许会帮到未来的自己。",
  "页面可以很轻，内容应该足够真。",
  "不是所有信息都值得保存，但值得保存的要容易找到。",
  "把入口统一之后，注意力就少了一次切换。"
];

function backgroundStyle(url: string) {
  const href = safeHref(url);
  if (!url || href === "#") return undefined;
  return { backgroundImage: `linear-gradient(var(--km-home-overlay), var(--km-home-overlay)), url("${href.replace(/"/g, "%22")}")` };
}

export function HomePage({ settings, user }: { settings: SiteSettings; user: SessionUser | null }) {
  const [recentPosts, setRecentPosts] = useState<PostRecord[]>([]);

  useEffect(() => {
    void requestJSON<{ posts: PostRecord[] }>("/api/blog/posts?limit=3&summary=1")
      .then((payload) => setRecentPosts(payload.posts ?? []))
      .catch(() => undefined);
  }, []);

  const avatarHref = safeHref(settings.avatarUrl);

  const quote = useMemo(() => {
    const configured = settings.quote?.trim();
    if (configured) return configured;
    return fallbackQuotes[Math.floor(Math.random() * fallbackQuotes.length)] ?? fallbackQuotes[0];
  }, [settings.quote]);

  const entries = settings.homeEntries?.length ? settings.homeEntries : [
    { id: "blog", name: "Blog", description: "文章与笔记", url: "/blog", newTab: false },
    { id: "start", name: "Start", description: "浏览器起始页", url: "/start", newTab: false },
    { id: "admin", name: "Admin", description: "管理后台", url: "/admin", newTab: false }
  ];

  return (
    <PageFrame settings={settings} user={user} className="km-home-page">
      <section className="km-home-hero" style={backgroundStyle(settings.homeBackgroundUrl)}>
        <div className="km-home-avatar">
          {settings.avatarUrl && avatarHref !== "#" ? <img src={avatarHref} alt="" /> : <span>K</span>}
        </div>
        <div className="km-home-copy">
          <span className="km-eyebrow">PERSONAL HOME</span>
          <h1>{settings.profileName || "Know Me"}</h1>
          <p className="km-home-tagline">{settings.profileTagline}</p>
          {settings.profileBio ? <p className="km-home-bio" id="about">{settings.profileBio}</p> : null}
          <div className="km-chip-row">
            {(settings.socialLinks ?? []).map((item) => {
              const href = safeHref(item.url);
              return <a key={item.id} href={href} target={isExternal(href) ? "_blank" : undefined} rel={isExternal(href) ? "noreferrer" : undefined}>{item.label}</a>;
            })}
            <a href="/blog">Blog</a>
            <a href="/feed.xml">RSS</a>
          </div>
        </div>
      </section>

      <section className={"km-home-grid" + (!settings.quoteEnabled ? " is-single" : "")}>
        {settings.quoteEnabled ? <article className="km-panel km-quote-card">
          <span className="km-eyebrow">今日短句</span>
          <blockquote>“{quote}”</blockquote>
          {settings.quoteAuthorEnabled ? <small>{settings.quoteAuthor || "Know Me"}</small> : null}
        </article> : null}
        <article className="km-panel km-now-card">
          <span className="km-eyebrow">NOW</span>
          <Clock />
        </article>
      </section>

      <section className="km-section">
        <header className="km-section-head">
          <div><span className="km-eyebrow">EXPLORE</span><h2>从这里进入</h2></div>
        </header>
        <div className="km-entry-grid">
          {entries.map((entry, index) => {
            const href = safeHref(entry.url);
            return (
              <a
                key={entry.id}
                className="km-entry-card"
                href={href}
                target={entry.newTab || isExternal(href) ? "_blank" : undefined}
                rel={entry.newTab || isExternal(href) ? "noreferrer" : undefined}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{entry.name}</strong>
                <p>{entry.description}</p>
                <b>↗</b>
              </a>
            );
          })}
        </div>
      </section>

      {(settings.projects ?? []).length ? (
        <section className="km-section" id="projects">
          <header className="km-section-head">
            <div><span className="km-eyebrow">PROJECTS</span><h2>项目与作品</h2></div>
          </header>
          <div className="km-project-grid">
            {settings.projects.map((project) => {
              const href = safeHref(project.url);
              return (
                <a key={project.id} className="km-panel km-project-card" href={href} target={isExternal(href) ? "_blank" : undefined} rel={isExternal(href) ? "noreferrer" : undefined}>
                  <span>{project.tag || "Project"}</span>
                  <strong>{project.name}</strong>
                  <p>{project.description}</p>
                </a>
              );
            })}
          </div>
        </section>
      ) : null}

      {recentPosts.length ? (
        <section className="km-section" id="recent-posts">
          <header className="km-section-head">
            <div><span className="km-eyebrow">RECENT</span><h2>最近文章</h2></div>
            <a className="km-section-more" href="/blog">查看全部 ›</a>
          </header>
          <div className="km-home-post-grid">
            {recentPosts.map((post) => (
              <a className="km-panel km-home-post-card" href={"/blog/" + encodeURIComponent(post.slug)} key={post.id}>
                <div>
                  <span>{post.categories[0] || "Blog"}</span>
                  <time>{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("zh-CN") : ""}</time>
                </div>
                <strong>{post.title}</strong>
                <p>{post.excerpt || "阅读全文"}</p>
                <b>阅读全文 ›</b>
              </a>
            ))}
          </div>
        </section>
      ) : null}

    </PageFrame>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const date = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now);
  return <div className="km-clock"><strong>{time}</strong><span>{date}</span></div>;
}
