import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { listAdminPosts } from "@/lib/blog/repository";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

function count(sql: string) {
  return (getDb().prepare(sql).get() as { count: number }).count;
}

function date(value: number) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export default function AdminPage() {
  const posts = listAdminPosts();
  const published = posts.filter((post) => post.status === "published").length;
  const drafts = posts.filter((post) => post.status === "draft").length;
  const navItems = count("SELECT COUNT(*) AS count FROM nav_items");
  const media = count("SELECT COUNT(*) AS count FROM media");

  return (
    <AdminShell active="dashboard">
      <div className="admin-heading">
        <div>
          <div className="eyebrow">Dashboard</div>
          <h1>晚上好</h1>
        </div>
        <Link className="primary-button" href="/admin/posts/new">＋ 写文章</Link>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><span className="muted">已发布文章</span><strong>{published}</strong></div>
        <div className="stat-card"><span className="muted">草稿</span><strong>{drafts}</strong></div>
        <div className="stat-card"><span className="muted">导航入口</span><strong>{navItems}</strong></div>
        <div className="stat-card"><span className="muted">媒体</span><strong>{media}</strong></div>
      </div>

      <div className="admin-grid">
        <div className="admin-panel">
          <strong>最近文章</strong>
          {posts.slice(0, 4).map((post) => (
            <Link className="admin-row admin-row-link" href={"/admin/posts/" + post.id} key={post.id}>
              <span>{post.title}</span>
              <span className={post.status === "published" ? "status-published" : ""}>
                {post.status === "published" ? "已发布" : post.status === "scheduled" ? "定时" : "草稿"}
              </span>
              <span>{date(post.updatedAt)}</span>
            </Link>
          ))}
          {posts.length === 0 ? <p className="muted">还没有文章。</p> : null}
        </div>

        <div className="admin-panel">
          <strong>快捷操作</strong>
          <Link className="quick-link" href="/admin/posts/new">写一篇 Markdown</Link>
          <Link className="quick-link" href="/admin/navigation">管理起始页</Link>
          <Link className="quick-link" href="/admin/navigation#import">导入 iTab 数据</Link>
          <Link className="quick-link" href="/start">查看起始页</Link>
          <Link className="quick-link" href="/admin/settings">个人主页 / 外观设置</Link>
        </div>
      </div>
    </AdminShell>
  );
}
