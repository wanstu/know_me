import { useMemo } from "react";
import type { SiteSettings } from "../types";
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

export function HomePage({ settings }: { settings: SiteSettings }) {
  const quote = useMemo(() => {
    const pool = settings.quote?.trim() ? [settings.quote.trim(), ...fallbackQuotes] : fallbackQuotes;
    return pool[Math.floor(Math.random() * pool.length)] ?? fallbackQuotes[0];
  }, [settings.quote]);

  const entries = settings.homeEntries?.length ? settings.homeEntries : [
    { id: "blog", name: "Blog", description: "文章与笔记", url: "/blog", newTab: false },
    { id: "start", name: "Start", description: "浏览器起始页", url: "/start", newTab: false },
    { id: "admin", name: "Admin", description: "管理后台", url: "/admin", newTab: false }
  ];

  return (
    <PageFrame settings={settings} className="km-home-page">
      <section className="km-home-hero" style={backgroundStyle(settings.homeBackgroundUrl)}>
        <div className="km-home-avatar">
          {settings.avatarUrl ? <img src={safeHref(settings.avatarUrl)} alt="" /> : <span>K</span>}
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

      <section className="km-home-grid">
        <article className="km-panel km-quote-card">
          <span className="km-eyebrow">今日短句</span>
          <blockquote>“{quote}”</blockquote>
          <small>{quote === settings.quote ? settings.quoteAuthor || "Know Me" : "Know Me"}</small>
        </article>
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
    </PageFrame>
  );
}

function Clock() {
  const now = new Date();
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const date = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now);
  return <div className="km-clock"><strong>{time}</strong><span>{date}</span></div>;
}
