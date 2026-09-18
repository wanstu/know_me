import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { listAdminPosts } from "@/lib/blog/repository";

export const runtime = "nodejs";

function format(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export default function AdminPostsPage() {
  const posts = listAdminPosts();

  return (
    <AdminShell active="posts">
      <div className="admin-heading">
        <div>
          <div className="eyebrow">Writing</div>
          <h1>文章</h1>
        </div>
        <Link className="primary-button" href="/admin/posts/new">＋ 新建文章</Link>
      </div>

      <div className="admin-panel post-admin-list">
        <div className="post-admin-head">
          <span>文章</span><span>状态</span><span>更新时间</span>
        </div>
        {posts.map((post) => (
          <Link className="post-admin-row" href={"/admin/posts/" + post.id} key={post.id}>
            <span>
              <strong>{post.title}</strong>
              <small>/{post.slug} {post.tags.length ? " · " + post.tags.map((tag) => "#" + tag).join(" ") : ""}</small>
            </span>
            <span className={"post-status post-status--" + post.status}>
              {post.status === "published" ? "已发布" : post.status === "scheduled" ? "定时" : "草稿"}
            </span>
            <span>{format(post.updatedAt)}</span>
          </Link>
        ))}
        {posts.length === 0 ? (
          <div className="admin-empty">
            还没有文章。<Link href="/admin/posts/new">写第一篇 Markdown</Link>
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
