import Link from "next/link";
import { AmbientWallpaper } from "@/components/ambient-wallpaper";
import { LiveClock } from "@/components/live-clock";
import { getSiteSettings } from "@/lib/settings/repository";

export const runtime = "nodejs";

const entrances = [
  { name: "Blog", desc: "文章与笔记", href: "/blog" },
  { name: "Start", desc: "浏览器起始页", href: "/start" },
  { name: "Projects", desc: "项目与作品", href: "#" },
  { name: "Archive", desc: "文章归档", href: "/blog#archive" },
  { name: "About", desc: "关于我", href: "#about" },
  { name: "Admin", desc: "管理后台", href: "/admin" }
];

function avatarSafe(value: string) {
  return /^https?:\/\//i.test(value) || value.startsWith("/media/");
}

export default function HomePage() {
  const settings = getSiteSettings();

  return (
    <main className="immersive-page">
      <AmbientWallpaper url={settings.homeBackgroundUrl} />
      <section className="home-layout container-wide">
        <article className="glass-card profile-card" id="about">
          <div className="profile-heading">
            <div className="avatar-placeholder">
              {settings.avatarUrl && avatarSafe(settings.avatarUrl)
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
            {settings.githubUrl ? <a href={settings.githubUrl} className="chip" target="_blank" rel="noreferrer">GitHub</a> : null}
            {settings.emailUrl ? <a href={settings.emailUrl} className="chip">Mail</a> : null}
            <Link href="/blog" className="chip">Blog</Link>
            <Link href="/feed.xml" className="chip">RSS</Link>
            {settings.aboutUrl ? <a href={settings.aboutUrl} className="chip" target="_blank" rel="noreferrer">About</a> : null}
          </div>
        </article>

        <section className="home-side">
          <article className="glass-card quote-card">
            <p>{settings.quote}</p>
            <span>— {settings.quoteAuthor}</span>
          </article>
          <article className="glass-card time-card">
            <LiveClock />
            <p className="muted">主页内容与背景可以在管理后台调整。</p>
          </article>

          <div className="entrance-block">
            <div className="eyebrow">Explore</div>
            <div className="entrance-grid">
              {entrances.map((item) => (
                <Link key={item.name} href={item.href} className="glass-card entrance-card">
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.desc}</small>
                  </span>
                  <span aria-hidden="true">↗</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
