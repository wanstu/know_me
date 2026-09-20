import Link from "next/link";
import { AmbientWallpaper } from "@/components/ambient-wallpaper";
import { LiveClock } from "@/components/live-clock";
import { PublicFooter } from "@/components/public-footer";
import { getSiteSettings } from "@/lib/settings/repository";
import { randomHomeQuote } from "@/lib/home/quotes";
import { themeClass } from "@/lib/settings/theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeHref(value: string, allowMailto = true) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (allowMailto && /^mailto:[^\s]+$/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  if (trimmed.startsWith("#")) return trimmed;
  return "";
}

function imageSafe(value: string) {
  return /^https?:\/\//i.test(value) || value.startsWith("/media/");
}

function external(value: string) {
  return /^https?:\/\//i.test(value);
}

export default function HomePage() {
  const settings = getSiteSettings();
  const socials = settings.socialLinks
    .map((item) => ({ ...item, href: safeHref(item.url) }))
    .filter((item) => item.label && item.href);
  const entries = settings.homeEntries
    .map((item) => ({ ...item, href: safeHref(item.url, false) }))
    .filter((item) => item.name && item.href);
  const projects = settings.projects
    .map((item) => ({ ...item, href: safeHref(item.url, false) }))
    .filter((item) => item.name);
  const dailyQuote = settings.quote.trim()
    ? { text: settings.quote.trim(), author: settings.quoteAuthor.trim() || "今日短句" }
    : randomHomeQuote();

  return (
    <main className={"immersive-page " + themeClass(settings)}>
      <AmbientWallpaper url={settings.homeBackgroundUrl} />

      <section className="home-layout container-wide">
        <article className="glass-card profile-card" id="about">
          <div className="profile-heading">
            <div className="avatar-placeholder">
              {settings.avatarUrl && imageSafe(settings.avatarUrl)
                ? <img src={settings.avatarUrl} alt={settings.profileName} />
                : settings.profileName.slice(0, 1).toLocaleUpperCase()}
            </div>
            <div>
              <div className="eyebrow">Personal Space</div>
              <h1>{settings.profileName}</h1>
              <p className="muted">{settings.profileTagline}</p>
            </div>
          </div>

          <p className="profile-lead">{settings.profileBio}</p>

          <div className="chip-row">
            {socials.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className="chip"
                target={external(item.href) ? "_blank" : undefined}
                rel={external(item.href) ? "noreferrer" : undefined}
              >
                {item.label}
              </a>
            ))}
            <Link href="/blog" className="chip">Blog</Link>
            <Link href="/feed.xml" className="chip">RSS</Link>
          </div>
        </article>

        <section className="home-side">
          {settings.quoteEnabled ? (
            <article className="glass-card quote-card">
              <p>{dailyQuote.text}</p>
              {settings.quoteAuthorEnabled ? <span>— {dailyQuote.author}</span> : null}
            </article>
          ) : null}

          <article className="glass-card time-card">
            <LiveClock />
            <p className="muted">主页内容与背景可以在管理后台调整。</p>
          </article>

          <div className="entrance-block">
            <div className="eyebrow">Explore</div>
            <div className="entrance-grid">
              {entries.map((item) => (
                <a
                  key={item.id}
                  href={item.href}
                  className="glass-card entrance-card"
                  target={item.newTab || external(item.href) ? "_blank" : undefined}
                  rel={item.newTab || external(item.href) ? "noreferrer" : undefined}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span aria-hidden="true">↗</span>
                </a>
              ))}
              {entries.length === 0 ? (
                <div className="glass-card home-empty-card">
                  <strong>还没有主页入口</strong>
                  <small>可以从管理后台添加 Blog、项目页或其他常用入口。</small>
                </div>
              ) : null}
            </div>
          </div>

          {projects.length ? (
            <div className="project-block" id="projects">
              <div className="home-section-heading">
                <div>
                  <div className="eyebrow">Projects</div>
                  <h2>项目与作品</h2>
                </div>
                <span className="muted">{projects.length} items</span>
              </div>

              <div className="project-grid">
                {projects.map((project) => {
                  const card = (
                    <>
                      <div className="project-card-top">
                        <strong>{project.name}</strong>
                        {project.tag ? <span>{project.tag}</span> : null}
                      </div>
                      <p>{project.description || "暂无说明"}</p>
                      {project.href ? <small>查看项目 ↗</small> : <small>仅展示</small>}
                    </>
                  );

                  return project.href ? (
                    <a
                      key={project.id}
                      href={project.href}
                      className="glass-card project-card"
                      target={external(project.href) ? "_blank" : undefined}
                      rel={external(project.href) ? "noreferrer" : undefined}
                    >
                      {card}
                    </a>
                  ) : (
                    <article key={project.id} className="glass-card project-card">
                      {card}
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      </section>
      <PublicFooter settings={settings} />
    </main>
  );
}
