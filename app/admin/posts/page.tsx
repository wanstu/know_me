import { AdminShell } from "@/components/admin/admin-shell";
import { AdminPostList } from "@/components/admin/post-list";
import { listAdminPosts } from "@/lib/blog/repository";

export const runtime = "nodejs";

export default function AdminPostsPage() {
  const posts = listAdminPosts();

  return (
    <AdminShell active="posts">
      <div className="admin-heading">
        <div>
          <div className="eyebrow">Writing</div>
          <h1>文章</h1>
          <p className="muted">管理 Markdown 文章、草稿、定时发布与历史版本。</p>
        </div>
      </div>
      <AdminPostList posts={posts} />
    </AdminShell>
  );
}
