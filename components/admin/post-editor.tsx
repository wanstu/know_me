"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/blog/markdown-renderer";
import type { PostRecord, PostRevisionRecord, PostStatus } from "@/lib/blog/repository";

type DraftState = {
  title: string;
  slug: string;
  excerpt: string;
  contentMd: string;
  status: PostStatus;
  pinned: boolean;
  seoTitle: string;
  seoDescription: string;
  tags: string;
  categories: string;
  publishAtLocal: string;
};

function localDateTime(value: number | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(value - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function initialDraft(post: PostRecord | null): DraftState {
  return {
    title: post?.title ?? "",
    slug: post?.slug ?? "",
    excerpt: post?.excerpt ?? "",
    contentMd: post?.contentMd ?? "# 新文章\n\n从这里开始写 Markdown。",
    status: post?.status ?? "draft",
    pinned: post?.pinned ?? false,
    seoTitle: post?.seoTitle ?? "",
    seoDescription: post?.seoDescription ?? "",
    tags: post?.tags.join(", ") ?? "",
    categories: post?.categories.join(", ") ?? "",
    publishAtLocal: localDateTime(post?.publishedAt ?? null)
  };
}

function splitNames(value: string) {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

export function PostEditor({ initialPost }: { initialPost: PostRecord | null }) {
  const [postId, setPostId] = useState<number | null>(initialPost?.id ?? null);
  const [storedPublishedAt, setStoredPublishedAt] = useState<number | null>(initialPost?.publishedAt ?? null);
  const [draft, setDraft] = useState<DraftState>(() => initialDraft(initialPost));
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState(initialPost ? "已载入" : "新草稿");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<PostRevisionRecord[]>([]);
  const savingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  function update<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  async function persist(statusOverride?: PostStatus, silent = false) {
    if (savingRef.current || !draft.title.trim()) return null;
    savingRef.current = true;
    if (!silent) setMessage("正在保存…");

    try {
      const nextStatus = statusOverride ?? draft.status;
      const publishedAt = nextStatus === "scheduled" && draft.publishAtLocal
        ? new Date(draft.publishAtLocal).getTime()
        : nextStatus === "published"
          ? (storedPublishedAt ?? Date.now())
          : null;

      const body = {
        title: draft.title,
        slug: draft.slug,
        excerpt: draft.excerpt,
        contentMd: draft.contentMd,
        status: nextStatus,
        pinned: draft.pinned,
        seoTitle: draft.seoTitle,
        seoDescription: draft.seoDescription,
        publishedAt,
        tags: splitNames(draft.tags),
        categories: splitNames(draft.categories)
      };

      const response = await fetch(postId ? "/api/posts/" + postId : "/api/posts", {
        method: postId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存失败");

      const saved = payload.post as PostRecord;
      setPostId(saved.id);
      setStoredPublishedAt(saved.publishedAt);
      setDraft((current) => ({
        ...current,
        slug: saved.slug,
        excerpt: saved.excerpt,
        status: saved.status,
        publishAtLocal: localDateTime(saved.publishedAt)
      }));
      setDirty(false);
      setMessage(silent ? "已自动保存" : saved.status === "published" ? "已发布" : saved.status === "scheduled" ? "已安排发布" : "草稿已保存");

      if (!postId) {
        window.history.replaceState({}, "", "/admin/posts/" + saved.id);
      }
      return saved;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
      return null;
    } finally {
      savingRef.current = false;
    }
  }

  useEffect(() => {
    if (!dirty || !draft.title.trim()) return;
    const timer = window.setTimeout(() => void persist(undefined, true), 1800);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, postId]);

  async function uploadImage(file: File) {
    if (!file.type.startsWith("image/")) return;
    setMessage("正在上传图片…");
    const form = new FormData();
    form.set("file", file);
    form.set("alt", file.name.replace(/\.[^.]+$/, ""));
    const response = await fetch("/api/media", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "图片上传失败");
      return;
    }

    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? draft.contentMd.length;
    const end = textarea?.selectionEnd ?? start;
    const alt = file.name.replace(/[\[\]]/g, "").replace(/\.[^.]+$/, "");
    const markdown = "![" + alt + "](" + payload.media.url + ")";
    setDraft((current) => ({
      ...current,
      contentMd: current.contentMd.slice(0, start) + markdown + current.contentMd.slice(end)
    }));
    setDirty(true);
    setMessage("图片已插入");
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + markdown.length, start + markdown.length);
    });
  }

  async function loadHistory() {
    if (!postId) return;
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next) return;
    const response = await fetch("/api/posts/" + postId + "/revisions");
    const payload = await response.json();
    if (response.ok) setRevisions(payload.revisions ?? []);
    else setMessage(payload.error || "历史版本加载失败");
  }

  async function restoreRevision(revisionId: number) {
    if (!postId || !window.confirm("恢复这个历史版本？当前内容会先自动形成一个新的历史版本。")) return;
    const response = await fetch("/api/posts/" + postId + "/revisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revisionId })
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "恢复失败");
      return;
    }
    const saved = payload.post as PostRecord;
    setDraft(initialDraft(saved));
    setStoredPublishedAt(saved.publishedAt);
    setRevisions(payload.revisions ?? []);
    setDirty(false);
    setMessage("已恢复历史版本");
  }

  async function remove() {
    if (!postId || !window.confirm("确定删除这篇文章？这个操作不会删除历史备份之外的数据。")) return;
    const response = await fetch("/api/posts/" + postId, { method: "DELETE" });
    if (response.ok) window.location.href = "/admin/posts";
  }

  return (
    <section className="editor-shell">
      <div className="editor-top">
        <Link href="/admin/posts" className="editor-back">←</Link>
        <input
          className="editor-title"
          value={draft.title}
          onChange={(event) => update("title", event.target.value)}
          placeholder="文章标题"
          aria-label="文章标题"
        />
        <span className="editor-save-state">{dirty ? "有未保存修改" : message}</span>
        <div className="editor-actions">
          <button type="button" onClick={() => void persist()}>保存</button>
          <button type="button" onClick={() => setSettingsOpen((value) => !value)}>设置</button>
          {postId ? <button type="button" onClick={() => void loadHistory()}>历史</button> : null}
          <button type="button" onClick={() => imageInputRef.current?.click()}>图片</button>
          <input ref={imageInputRef} className="editor-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); event.currentTarget.value = ""; }} />
          {postId ? <button type="button" className="editor-delete" onClick={() => void remove()}>删除</button> : null}
          <button className="publish" type="button" onClick={() => void persist("published")}>发布</button>
        </div>
      </div>

      {settingsOpen ? (
        <section className="editor-settings">
          <div className="editor-settings-grid">
            <label>Slug<input value={draft.slug} onChange={(event) => update("slug", event.target.value)} placeholder="自动根据标题生成" /></label>
            <label>状态<select value={draft.status} onChange={(event) => update("status", event.target.value as PostStatus)}><option value="draft">草稿</option><option value="published">已发布</option><option value="scheduled">定时发布</option></select></label>
            <label>标签<input value={draft.tags} onChange={(event) => update("tags", event.target.value)} placeholder="开发, Markdown" /></label>
            <label>分类<input value={draft.categories} onChange={(event) => update("categories", event.target.value)} placeholder="技术笔记" /></label>
            <label className="span-2">摘要<textarea value={draft.excerpt} onChange={(event) => update("excerpt", event.target.value)} placeholder="留空则从正文自动生成" /></label>
            {draft.status === "scheduled" ? <label>发布时间<input type="datetime-local" value={draft.publishAtLocal} onChange={(event) => update("publishAtLocal", event.target.value)} /></label> : null}
            <label className="check-label"><input type="checkbox" checked={draft.pinned} onChange={(event) => update("pinned", event.target.checked)} /> 置顶文章</label>
            <label>SEO 标题<input value={draft.seoTitle} onChange={(event) => update("seoTitle", event.target.value)} /></label>
            <label>SEO 描述<input value={draft.seoDescription} onChange={(event) => update("seoDescription", event.target.value)} /></label>
          </div>
        </section>
      ) : null}

      {historyOpen ? (
        <section className="editor-history">
          <div className="editor-history-head">
            <strong>历史版本</strong>
            <span className="muted">保存正文或标题变化时自动生成</span>
          </div>
          <div className="editor-history-list">
            {revisions.map((revision) => (
              <div className="editor-history-row" key={revision.id}>
                <div>
                  <strong>{typeof revision.metadata.title === "string" ? revision.metadata.title : "历史版本"}</strong>
                  <small>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(revision.createdAt))}</small>
                </div>
                <button type="button" onClick={() => void restoreRevision(revision.id)}>恢复</button>
              </div>
            ))}
            {revisions.length === 0 ? <p className="muted">还没有历史版本。</p> : null}
          </div>
        </section>
      ) : null}

      <div className="editor-grid editor-grid--post">
        <section className="editor-pane">
          <textarea
            ref={textareaRef}
            value={draft.contentMd}
            onChange={(event) => update("contentMd", event.target.value)}
            onPaste={(event) => { const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/")); if (file) { event.preventDefault(); void uploadImage(file); } }}
            aria-label="Markdown 编辑器"
            spellCheck={false}
          />
        </section>
        <section className="preview-pane">
          <div className="eyebrow" style={{ color: "#778395" }}>Preview</div>
          <h1>{draft.title || "无标题"}</h1>
          <MarkdownRenderer content={draft.contentMd} className="prose editor-preview-prose" />
        </section>
      </div>

      {postId && draft.status === "published" && draft.slug ? (
        <div className="editor-public-link">
          <Link href={"/blog/" + encodeURIComponent(draft.slug)} target="_blank">打开公开文章 ↗</Link>
        </div>
      ) : null}
    </section>
  );
}
