"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PostRecord, PostStatus } from "@/lib/blog/repository";

function format(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function AdminPostList({ posts }: { posts: PostRecord[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | PostStatus>("all");

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return posts.filter((post) => {
      if (status !== "all" && post.status !== status) return false;
      if (!needle) return true;
      return [
        post.title,
        post.slug,
        post.excerpt,
        ...post.tags,
        ...post.categories
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [posts, query, status]);

  const noPosts = posts.length === 0;
  const noMatches = !noPosts && filtered.length === 0;

  return (
    <>
      <div className="admin-panel post-list-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题、Slug、分类或标签…"
          aria-label="搜索文章"
        />
        <div className="post-status-filter" aria-label="文章状态筛选">
          {([
            ["all", "全部"],
            ["published", "已发布"],
            ["draft", "草稿"],
            ["scheduled", "定时"]
          ] as const).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={status === value ? "is-active" : ""}
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="post-list-count">{filtered.length} / {posts.length}</span>
        <div className="post-list-actions">
          <Link className="secondary-button" href="/admin/posts/new?import=1">导入 Markdown</Link>
          <Link className="primary-button" href="/admin/posts/new">＋ 新建文章</Link>
        </div>
      </div>

      <div className="admin-panel post-admin-list">
        {!noPosts ? (
          <div className="post-admin-head">
            <span>文章</span><span>状态</span><span>更新时间</span>
          </div>
        ) : null}

        {filtered.map((post) => (
          <Link className="post-admin-row" href={"/admin/posts/" + post.id} key={post.id}>
            <span>
              <strong>{post.title}</strong>
              <small>
                /{post.slug}
                {post.categories.length ? " · " + post.categories.join(" / ") : ""}
                {post.tags.length ? " · " + post.tags.map((tag) => "#" + tag).join(" ") : ""}
              </small>
            </span>
            <span className={"post-status post-status--" + post.status}>
              {post.status === "published" ? "已发布" : post.status === "scheduled" ? "定时" : "草稿"}
            </span>
            <span>{format(post.updatedAt)}</span>
          </Link>
        ))}

        {noPosts ? (
          <div className="admin-empty post-empty-state">
            <strong>还没有文章</strong>
            <p>可以从空白文章开始，也可以直接导入现有 Markdown。</p>
            <div>
              <Link className="primary-button" href="/admin/posts/new">新建文章</Link>
              <Link className="secondary-button" href="/admin/posts/new?import=1">导入 Markdown</Link>
            </div>
          </div>
        ) : noMatches ? (
          <div className="admin-empty post-empty-state">
            <strong>没有匹配的文章</strong>
            <p>调整搜索词或状态筛选后再试。</p>
            <button type="button" className="secondary-button" onClick={() => { setQuery(""); setStatus("all"); }}>清除筛选</button>
          </div>
        ) : null}
      </div>
    </>
  );
}
