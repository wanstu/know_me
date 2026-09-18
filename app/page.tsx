import Link from "next/link";
import { LiveClock } from "@/components/live-clock";

const entrances = [
  { name: "Blog", desc: "文章与笔记", href: "/blog" },
  { name: "Start", desc: "浏览器起始页", href: "/start" },
  { name: "Projects", desc: "项目与作品", href: "#" },
  { name: "Archive", desc: "文章归档", href: "/blog" },
  { name: "About", desc: "关于我", href: "#" },
  { name: "Admin", desc: "管理后台", href: "/admin" }
];

export default function HomePage() {
  return (
    <main className="immersive-page">
      <div className="ambient-wallpaper" aria-hidden="true" />
      <section className="home-layout container-wide">
        <article className="glass-card profile-card">
          <div className="profile-heading">
            <div className="avatar-placeholder">K</div>
            <div>
              <div className="eyebrow">Personal Space</div>
              <h1>know_me</h1>
              <p className="muted">记录、创造，也把每天真正会用的东西放在这里。</p>
            </div>
          </div>
          <p className="profile-lead">
            一个属于自己的数字入口：主页、博客和浏览器起始页，不再分散在不同服务里。
          </p>
          <div className="chip-row">
            <a href="#" className="chip">GitHub</a>
            <a href="#" className="chip">Mail</a>
            <Link href="/blog" className="chip">RSS</Link>
            <a href="#" className="chip">About</a>
          </div>
        </article>

        <section className="home-side">
          <article className="glass-card quote-card">
            <p>生命如意志永存，青春永远年轻。</p>
            <span>— 今日短句</span>
          </article>
          <article className="glass-card time-card">
            <LiveClock />
            <p className="muted">时间、天气与短句都可以在后台自由配置。</p>
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
