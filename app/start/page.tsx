import Link from "next/link";
import { LiveClock } from "@/components/live-clock";
import { startTiles } from "@/lib/demo-data";

const groups = ["⌂", "社", "文", "框", "游", "工", "⚙"];

export default function StartPage() {
  return (
    <main className="immersive-page start-page">
      <div className="ambient-wallpaper" aria-hidden="true" />
      <aside className="glass-card start-rail" aria-label="导航分组">
        {groups.map((group, index) => (
          <button key={group} className={index === 0 ? "is-active" : ""} type="button">
            {group}
          </button>
        ))}
      </aside>

      <section className="start-content">
        <div className="start-hero">
          <LiveClock compact />
          <form className="glass-card search-box" action="https://www.bing.com/search" method="get">
            <span aria-hidden="true">⌕</span>
            <input name="q" placeholder="搜索网页，或输入链接…" autoComplete="off" />
            <button type="submit">Bing ↗</button>
          </form>
        </div>

        <div className="start-toolbar">
          <div>
            <span className="eyebrow">Navigation</span>
            <h1>主页</h1>
          </div>
          <div className="toolbar-buttons">
            <button type="button" title="新增">＋</button>
            <button type="button" title="编辑">✎</button>
            <Link href="/admin" title="管理">⚙</Link>
          </div>
        </div>

        <div className="tile-grid">
          {startTiles.map((tile) => {
            const className = [
              "start-tile",
              "glass-card",
              tile.wide ? "start-tile--wide" : "",
              tile.folder ? "start-tile--folder" : "",
              tile.tone ? "tone-" + tile.tone : ""
            ].filter(Boolean).join(" ");

            if (tile.folder) {
              return (
                <button className={className} key={tile.name} type="button">
                  <span className="folder-preview"><i /><i /><i /><i /></span>
                  <strong>{tile.name}</strong>
                </button>
              );
            }

            return (
              <a className={className} key={tile.name} href={tile.href}>
                <span className="tile-mark">{tile.mark}</span>
                <strong>{tile.name}</strong>
              </a>
            );
          })}
          <button className="start-tile glass-card start-tile--add" type="button">
            <span className="tile-mark">＋</span>
            <strong>新增</strong>
          </button>
        </div>

        <p className="prototype-note">
          当前为 Phase 3.1 静态数据。Phase 3.3 会替换为数据库导航，并接入 iTab 导入、拖拽和权限控制。
        </p>
      </section>
    </main>
  );
}
