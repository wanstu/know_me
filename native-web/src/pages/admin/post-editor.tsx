import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import { requestJSON } from "../../api";
import type { PostRecord, PostRevision } from "../../types";
import { AdminTitle, ErrorCard, LoadingCard } from "../../ui";

type EditorState = {
  title: string;
  slug: string;
  excerpt: string;
  contentMd: string;
  status: "draft" | "published" | "scheduled";
  pinned: boolean;
  seoTitle: string;
  seoDescription: string;
  publishedAt: string;
  tags: string;
  categories: string;
};

function fromPost(post?: PostRecord | null): EditorState {
  return {
    title: post?.title ?? "",
    slug: post?.slug ?? "",
    excerpt: post?.excerpt ?? "",
    contentMd: post?.contentMd ?? "",
    status: post?.status ?? "draft",
    pinned: post?.pinned ?? false,
    seoTitle: post?.seoTitle ?? "",
    seoDescription: post?.seoDescription ?? "",
    publishedAt: post?.publishedAt ? new Date(post.publishedAt).toISOString().slice(0, 16) : "",
    tags: post?.tags.join(", ") ?? "",
    categories: post?.categories.join(", ") ?? ""
  };
}

function splitNames(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function insertAround(
  textarea: HTMLTextAreaElement,
  before: string,
  after = before,
  fallback = "文本"
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end) || fallback;
  const next = textarea.value.slice(0, start) + before + selected + after + textarea.value.slice(end);
  const cursorStart = start + before.length;
  return { next, start: cursorStart, end: cursorStart + selected.length };
}

export function PostEditor({ id }: { id?: number }) {
  const [draft, setDraft] = useState<EditorState>(() => fromPost());
  const [loaded, setLoaded] = useState(!id);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [revisions, setRevisions] = useState<PostRevision[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!id) return;
    void Promise.all([
      requestJSON<{ post: PostRecord }>("/api/posts/" + id),
      requestJSON<{ revisions: PostRevision[] }>("/api/posts/" + id + "/revisions")
    ])
      .then(([postPayload, revisionPayload]) => {
        setDraft(fromPost(postPayload.post));
        setRevisions(revisionPayload.revisions ?? []);
        setLoaded(true);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "post_failed");
        setLoaded(true);
      });
  }, [id]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function update<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setMessage("");
  }

  function applyToolbar(before: string, after?: string, fallback?: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = insertAround(textarea, before, after, fallback);
    update("contentMd", result.next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.start, result.end);
    });
  }

  function insertText(value: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      update("contentMd", draft.contentMd + value);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = textarea.value.slice(0, start) + value + textarea.value.slice(end);
    update("contentMd", next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + value.length, start + value.length);
    });
  }

  async function uploadImage(file: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("alt", file.name.replace(/\.[^.]+$/, ""));
      const response = await fetch("/api/media", { method: "POST", body: form, credentials: "same-origin" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "upload_failed");
      const alt = payload.media?.alt || file.name;
      insertText(`![${alt}](${payload.media.url})`);
      setMessage("图片已上传并插入");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "upload_failed");
    } finally {
      setBusy(false);
    }
  }

  async function importMarkdown(file: File) {
    const text = await file.text();
    update("contentMd", text);
    if (!draft.title.trim()) update("title", file.name.replace(/\.md$/i, ""));
    setMessage("Markdown 已导入");
  }

  function exportMarkdown() {
    const blob = new Blob([draft.contentMd], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = (draft.slug || draft.title || "article").replace(/[^a-z0-9_-]+/gi, "-") + ".md";
    anchor.click();
    URL.revokeObjectURL(href);
  }

  async function save(event?: FormEvent, overrideStatus?: EditorState["status"]) {
    event?.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const status = overrideStatus ?? draft.status;
      const publishedAt = draft.publishedAt ? new Date(draft.publishedAt).getTime() : null;
      const payload = await requestJSON<{ post: PostRecord }>(id ? "/api/posts/" + id : "/api/posts", {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          slug: draft.slug,
          excerpt: draft.excerpt,
          contentMd: draft.contentMd,
          status,
          pinned: draft.pinned,
          seoTitle: draft.seoTitle,
          seoDescription: draft.seoDescription,
          publishedAt,
          tags: splitNames(draft.tags),
          categories: splitNames(draft.categories)
        })
      });
      setDraft(fromPost(payload.post));
      setDirty(false);
      setMessage(status === "published" ? "已发布" : "已保存");
      if (!id) {
        window.history.replaceState({}, "", "/admin/posts/" + payload.post.id);
        window.location.reload();
        return;
      }
      const revisionPayload = await requestJSON<{ revisions: PostRevision[] }>("/api/posts/" + id + "/revisions");
      setRevisions(revisionPayload.revisions ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "save_failed");
    } finally {
      setBusy(false);
    }
  }

  async function restore(revisionId: number) {
    if (!id || !window.confirm("恢复这个历史版本？当前内容会先自动形成新的历史版本。")) return;
    setBusy(true);
    try {
      const payload = await requestJSON<{ post: PostRecord; revisions: PostRevision[] }>("/api/posts/" + id + "/revisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revisionId })
      });
      setDraft(fromPost(payload.post));
      setRevisions(payload.revisions ?? []);
      setDirty(false);
      setMessage("历史版本已恢复");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "restore_failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id || !window.confirm("确认删除这篇文章？这个操作不可撤销。")) return;
    setBusy(true);
    try {
      await requestJSON("/api/posts/" + id, { method: "DELETE" });
      window.location.href = "/admin/posts";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "delete_failed");
      setBusy(false);
    }
  }

  const wordCount = useMemo(() => draft.contentMd.trim().split(/\s+/).filter(Boolean).length, [draft.contentMd]);

  if (!loaded) return <LoadingCard text="正在加载文章…" />;
  if (error && !draft.title && id) return <ErrorCard message={error} />;

  return (
    <>
      <AdminTitle
        eyebrow="EDITOR"
        title={id ? "编辑文章" : "新建文章"}
        description="Markdown 为主，支持实时预览、自动历史版本和发布状态。"
      />
      <form className="km-editor-layout" onSubmit={(event) => void save(event)}>
        <section className="km-panel km-editor-main">
          <div className="km-editor-heading">
            <label className="dk-field">标题<input value={draft.title} onChange={(e) => update("title", e.target.value)} placeholder="文章标题" /></label>
            <label className="dk-field">Slug<input value={draft.slug} onChange={(e) => update("slug", e.target.value)} placeholder="自动根据标题生成" /></label>
          </div>

          <div className="km-editor-toolbar">
            <button type="button" onClick={() => applyToolbar("## ", "", "小节标题")}>H2</button>
            <button type="button" onClick={() => applyToolbar("**", "**", "粗体")}>B</button>
            <button type="button" onClick={() => applyToolbar("*", "*", "斜体")}>I</button>
            <button type="button" onClick={() => applyToolbar("[", "](https://)", "链接文字")}>链接</button>
            <button type="button" onClick={() => applyToolbar("> ", "", "引用")}>引用</button>
            <button type="button" onClick={() => applyToolbar("- ", "", "列表项")}>列表</button>
            <button type="button" onClick={() => applyToolbar("- [ ] ", "", "任务")}>任务</button>
            <button type="button" onClick={() => applyToolbar("`", "`", "代码")}>代码</button>
            <button type="button" onClick={() => applyToolbar("\n\n```\n", "\n```\n", "代码块")}>代码块</button>
            <button type="button" onClick={() => mediaInputRef.current?.click()}>图片</button>
            <label className="km-editor-file-button">导入 MD<input hidden type="file" accept=".md,text/markdown,text/plain" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importMarkdown(file); e.currentTarget.value = ""; }} /></label>
            <button type="button" onClick={exportMarkdown}>导出 MD</button>
            <input ref={mediaInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadImage(file); e.currentTarget.value = ""; }} />
          </div>

          <div className="km-editor-split">
            <label className="km-editor-source">
              <span>Markdown · {wordCount} 词</span>
              <textarea
                ref={textareaRef}
                value={draft.contentMd}
                onChange={(e) => update("contentMd", e.target.value)}
                onPaste={(event) => {
                  const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
                  if (file) {
                    event.preventDefault();
                    void uploadImage(file);
                  }
                }}
                placeholder="# 开始写作…"
                spellCheck={false}
              />
            </label>
            <div className="km-editor-preview">
              <span>实时预览</span>
              <article className="km-markdown">
                {draft.contentMd ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug, rehypeHighlight]}>
                    {draft.contentMd}
                  </ReactMarkdown>
                ) : <p className="km-muted">这里会实时显示 Markdown 预览。</p>}
              </article>
            </div>
          </div>
        </section>

        <aside className="km-editor-side">
          <section className="km-panel km-editor-settings">
            <h3>发布</h3>
            <label className="dk-field">状态
              <select value={draft.status} onChange={(e) => update("status", e.target.value as EditorState["status"])}>
                <option value="draft">草稿</option>
                <option value="published">已发布</option>
                <option value="scheduled">定时发布</option>
              </select>
            </label>
            {draft.status === "scheduled" ? (
              <label className="dk-field">发布时间<input type="datetime-local" value={draft.publishedAt} onChange={(e) => update("publishedAt", e.target.value)} /></label>
            ) : null}
            <label className="km-check"><input type="checkbox" checked={draft.pinned} onChange={(e) => update("pinned", e.target.checked)} /><span><strong>置顶文章</strong></span></label>
            <div className="km-editor-actions">
              <button className="dk-button dk-button-primary" disabled={busy || !draft.title.trim()}>{busy ? "保存中…" : "保存"}</button>
              <button type="button" className="dk-button" disabled={busy || !draft.title.trim()} onClick={() => void save(undefined, "published")}>保存并发布</button>
            </div>
            {message ? <div className="dk-message">{message}</div> : null}
            {error ? <div className="dk-message is-danger">{error}</div> : null}
          </section>

          <section className="km-panel km-editor-settings">
            <h3>分类</h3>
            <label className="dk-field">分类<input value={draft.categories} onChange={(e) => update("categories", e.target.value)} placeholder="开发, 随笔" /></label>
            <label className="dk-field">标签<input value={draft.tags} onChange={(e) => update("tags", e.target.value)} placeholder="Go, Wails, Note" /></label>
          </section>

          <section className="km-panel km-editor-settings">
            <h3>摘要与 SEO</h3>
            <label className="dk-field">摘要<textarea rows={4} value={draft.excerpt} onChange={(e) => update("excerpt", e.target.value)} placeholder="留空自动生成" /></label>
            <label className="dk-field">SEO 标题<input value={draft.seoTitle} onChange={(e) => update("seoTitle", e.target.value)} /></label>
            <label className="dk-field">SEO 描述<textarea rows={3} value={draft.seoDescription} onChange={(e) => update("seoDescription", e.target.value)} /></label>
          </section>

          {id ? (
            <section className="km-panel km-editor-settings">
              <h3>历史版本</h3>
              <div className="km-revision-list">
                {revisions.slice(0, 12).map((revision) => (
                  <button type="button" key={revision.id} onClick={() => void restore(revision.id)}>
                    <span>{new Date(revision.createdAt).toLocaleString("zh-CN")}</span>
                    <small>{String(revision.metadata?.title ?? "历史版本")}</small>
                  </button>
                ))}
                {!revisions.length ? <small className="km-muted">暂时没有历史版本。</small> : null}
              </div>
            </section>
          ) : null}

          <div className="km-editor-bottom-links">
            <a className="dk-button" href="/admin/posts">返回文章列表</a>
            {id ? <button type="button" className="dk-button km-danger-button" onClick={() => void remove()} disabled={busy}>删除文章</button> : null}
          </div>
        </aside>
      </form>
    </>
  );
}
