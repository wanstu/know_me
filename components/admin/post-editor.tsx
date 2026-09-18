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
  const markdownInputRef = useRef<HTMLInputElement | null>(null);

  function update<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function replaceSelection(before: string, after = before, placeholder = "文字") {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? draft.contentMd.length;
    const end = textarea?.selectionEnd ?? start;
    const selected = draft.contentMd.slice(start, end) || placeholder;
    const insertion = before + selected + after;

    setDraft((current) => ({
      ...current,
      contentMd: current.contentMd.slice(0, start) + insertion + current.contentMd.slice(end)
    }));
    setDirty(true);

    window.requestAnimationFrame(() => {
      textarea?.focus();
      const selectionStart = start + before.length;
      textarea?.setSelectionRange(selectionStart, selectionStart + selected.length);
    });
  }

  function prefixSelectionLines(prefix: string, placeholder = "内容") {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? draft.contentMd.length;
    const end = textarea?.selectionEnd ?? start;
    const selected = draft.contentMd.slice(start, end) || placeholder;
    const insertion = selected.split(/\r?\n/).map((line) => prefix + line).join("\n");

    setDraft((current) => ({
      ...current,
      contentMd: current.contentMd.slice(0, start) + insertion + current.contentMd.slice(end)
    }));
    setDirty(true);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start, start + insertion.length);
    });
  }

  function insertBlock(content: string) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? draft.contentMd.length;
    const end = textarea?.selectionEnd ?? start;
    const before = draft.contentMd.slice(0, start);
    const needsLeadingBreak = before.length > 0 && !before.endsWith("\n");
    const insertion = (needsLeadingBreak ? "\n" : "") + content;

    setDraft((current) => ({
      ...current,
      contentMd: current.contentMd.slice(0, start) + insertion + current.contentMd.slice(end)
    }));
    setDirty(true);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLocaleLowerCase();
    if (key === "b") {
      event.preventDefault();
      replaceSelection("**", "**", "加粗文字");
    } else if (key === "i") {
      event.preventDefault();
      replaceSelection("_", "_", "斜体文字");
    } else if (key === "k") {
      event.preventDefault();
      replaceSelection("[", "](https://)", "链接文字");
    }
  }

  async function importMarkdown(file: File) {
    if (dirty && !window.confirm("当前有未保存修改，导入 Markdown 会替换正文，确定继续？")) return;
    const content = await file.text();
    const filename = file.name.replace(/\.md(?:own)?$/i, "");
    setDraft((current) => ({
      ...current,
      title: current.title.trim() ? current.title : filename,
      contentMd: content
    }));
    setDirty(true);
    setMessage("已导入 Markdown");
  }

  function exportMarkdown() {
    const blob = new Blob([draft.contentMd], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const base = (draft.slug || draft.title || "article").replace(/[\\/:*?"<>|]+/g, "-");
    link.href = url;
    link.download = base + ".md";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Markdown 已导出");
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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") {
        event.preventDefault();
        void persist();
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        void persist("published");
      }
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty, draft, postId, storedPublishedAt]);

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

  async function openPreview() {
    const saved = dirty ? await persist() : postId ? { id: postId } : await persist();
    const id = saved?.id ?? postId;
    if (!id) return;
    window.open("/admin/posts/" + id + "/preview", "_blank", "noopener,noreferrer");
  }

  async function remove() {
    if (!postId || !window.confirm("确定删除这篇文章？这个操作不会删除历史备份之外的数据。")) return;
    const response = await fetch("/api/posts/" + postId, { method: "DELETE" });
    if (response.ok) window.location.href = "/admin/posts";
  }

  return (
    <section className="editor-shell">
      <div className="editor-top">
        <Link href="/admin/posts" className="editor-back" onClick={(event) => { if (dirty && !window.confirm("还有未保存修改，确定离开编辑器？")) event.preventDefault(); }}>←</Link>
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
          <button type="button" onClick={() => markdownInputRef.current?.click()}>导入 MD</button>
          <button type="button" onClick={exportMarkdown}>导出 MD</button>
          <button type="button" onClick={() => void openPreview()}>预览</button>
          <input ref={imageInputRef} className="editor-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); event.currentTarget.value = ""; }} />
          <input ref={markdownInputRef} className="editor-file-input" type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importMarkdown(file); event.currentTarget.value = ""; }} />
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

      <div className="editor-markdown-toolbar" aria-label="Markdown 工具栏">
        <button type="button" title="二级标题" onMouseDown={(event) => event.preventDefault()} onClick={() => prefixSelectionLines("## ", "标题")}>H2</button>
        <button type="button" title="加粗 Ctrl+B" onMouseDown={(event) => event.preventDefault()} onClick={() => replaceSelection("**", "**", "加粗文字")}><strong>B</strong></button>
        <button type="button" title="斜体 Ctrl+I" onMouseDown={(event) => event.preventDefault()} onClick={() => replaceSelection("_", "_", "斜体文字")}><em>I</em></button>
        <button type="button" title="链接 Ctrl+K" onMouseDown={(event) => event.preventDefault()} onClick={() => replaceSelection("[", "](https://)", "链接文字")}>链接</button>
        <button type="button" title="引用" onMouseDown={(event) => event.preventDefault()} onClick={() => prefixSelectionLines("> ", "引用内容")}>❯</button>
        <button type="button" title="无序列表" onMouseDown={(event) => event.preventDefault()} onClick={() => prefixSelectionLines("- ", "列表项")}>• 列表</button>
        <button type="button" title="任务列表" onMouseDown={(event) => event.preventDefault()} onClick={() => prefixSelectionLines("- [ ] ", "待办事项")}>☐ 待办</button>
        <button type="button" title="行内代码" onMouseDown={(event) => event.preventDefault()} onClick={() => replaceSelection("`", "`", "code")}>{"</>"}</button>
        <button type="button" title="代码块" onMouseDown={(event) => event.preventDefault()} onClick={() => replaceSelection("```\n", "\n```", "code")}>代码块</button>
        <button type="button" title="分隔线" onMouseDown={(event) => event.preventDefault()} onClick={() => insertBlock("\n---\n")}>—</button>
        <button type="button" title="插入图片" onMouseDown={(event) => event.preventDefault()} onClick={() => imageInputRef.current?.click()}>图片</button>
        <span className="editor-toolbar-hint">Ctrl+S 保存 · Ctrl+Shift+Enter 发布</span>
      </div>

      <div className="editor-grid editor-grid--post">
        <section className="editor-pane">
          <textarea
            ref={textareaRef}
            value={draft.contentMd}
            onChange={(event) => update("contentMd", event.target.value)}
            onKeyDown={handleEditorKeyDown}
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
