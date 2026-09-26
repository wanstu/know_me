import { FormEvent, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { requestAPI, requestJSON } from "../../api";
import { contentStats } from "../../content";
import { MarkdownRenderer, parseMarkdownImport, type MarkdownImportMode } from "../../markdown";
import { validateMediaFile } from "../../media";
import type { PostRecord, PostRevision } from "../../types";
import { AdminTitle, ConfirmDialog, ErrorCard, LoadingCard, Toast, errorText } from "../../ui";

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
  firstPublishedAt: string;
  tags: string;
  categories: string;
};

type LocalDraftSnapshot = {
  draft: EditorState;
  savedAt: number;
  baseUpdatedAt: number;
};

function localDateTimeInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localDraftKey(id?: number) {
  return "know-me:post-local-draft:" + (id ?? "new");
}

function readLocalDraft(id?: number): LocalDraftSnapshot | null {
  try {
    const raw = window.localStorage.getItem(localDraftKey(id));
    if (!raw) return null;
    const value = JSON.parse(raw) as LocalDraftSnapshot;
    if (!value?.draft || typeof value.savedAt !== "number") return null;
    if (typeof value.draft.firstPublishedAt !== "string") value.draft.firstPublishedAt = "";
    return value;
  } catch {
    return null;
  }
}

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
    publishedAt: post?.publishedAt ? localDateTimeInput(new Date(post.publishedAt)) : "",
    firstPublishedAt: post?.firstPublishedAt ? localDateTimeInput(new Date(post.firstPublishedAt)) : "",
    tags: post?.tags.join(", ") ?? "",
    categories: post?.categories.join(", ") ?? ""
  };
}

function splitNames(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

type DiffLine = { type: "same" | "add" | "remove"; text: string };

function diffLines(current: string, historical: string): DiffLine[] {
  const a = historical.split("\n");
  const b = current.split("\n");
  if (a.length > 250 || b.length > 250) {
    return [
      { type: "remove", text: `历史版本：${a.length} 行` },
      { type: "add", text: `当前版本：${b.length} 行` }
    ];
  }
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: "add", text: b[j] });
      j++;
    } else if (i < a.length) {
      result.push({ type: "remove", text: a[i] });
      i++;
    }
  }
  return result.slice(0, 800);
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

function NameChips({ label, value, suggestions, onChange }: { label: string; value: string; suggestions: string[]; onChange: (value: string) => void }) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const values = splitNames(value);
  const menuID = "km-" + label + "-suggestions";
  const needle = input.trim().toLocaleLowerCase();
  const available = suggestions
    .filter((item) => !values.some((value) => value.toLocaleLowerCase() === item.toLocaleLowerCase()))
    .filter((item) => !needle || item.toLocaleLowerCase().includes(needle))
    .slice(0, 8);
  const canCreate = Boolean(
    input.trim() &&
    !values.some((item) => item.toLocaleLowerCase() === needle) &&
    !suggestions.some((item) => item.toLocaleLowerCase() === needle)
  );

  function add(raw = input) {
    const next = raw.trim().replace(/,+$/, "").trim();
    if (!next) return;
    if (!values.some((item) => item.toLocaleLowerCase() === next.toLocaleLowerCase())) {
      onChange([...values, next].join(", "));
    }
    setInput("");
  }

  function remove(name: string) {
    onChange(values.filter((item) => item !== name).join(", "));
  }

  return (
    <div className="dk-field km-name-chips">
      <span>{label}</span>
      <div className="km-name-chip-list">
        {values.map((item) => <button type="button" key={item} onClick={() => remove(item)} title={"移除 " + item}>{item}<b>×</b></button>)}
        <input
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={menuID}
          value={input}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setInput(event.target.value);
            setOpen(true);
          }}
          onBlur={() => {
            add();
            setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            } else if (event.key === "Backspace" && !input && values.length) {
              remove(values[values.length - 1]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={values.length ? "继续添加…" : "搜索或创建" + label}
        />
        {open && (available.length > 0 || canCreate) ? (
          <div className="km-name-chip-suggestions" id={menuID} role="listbox" aria-label={label + "候选项"}>
            {available.map((item) => (
              <button
                type="button"
                role="option"
                aria-selected="false"
                key={item}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add(item)}
              >
                <span>{item}</span><small>已有{label}</small>
              </button>
            ))}
            {canCreate ? (
              <button
                type="button"
                className="is-create"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add()}
              >
                <span>创建“{input.trim()}”</span><small>新{label}</small>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function PostEditor({ id }: { id?: number }) {
  const [draft, setDraft] = useState<EditorState>(() => fromPost());
  const [loaded, setLoaded] = useState(!id);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [revisions, setRevisions] = useState<PostRevision[]>([]);
  const [taxonomy, setTaxonomy] = useState<{ tags: string[]; categories: string[] }>({ tags: [], categories: [] });
  const [pendingAction, setPendingAction] = useState<
    | { kind: "delete" }
    | { kind: "restore"; revisionId: number }
    | { kind: "publish" }
    | null
  >(null);
  const [previewRevision, setPreviewRevision] = useState<PostRevision | null>(null);
  const [localDraft, setLocalDraft] = useState<LocalDraftSnapshot | null>(null);
  const [serverUpdatedAt, setServerUpdatedAt] = useState(0);
  const [localDraftPreviewOpen, setLocalDraftPreviewOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [viewMode, setViewMode] = useState<"split" | "edit" | "preview">(() => typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches ? "edit" : "split");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<MarkdownImportMode>("plain");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const bypassBeforeUnloadRef = useRef(false);

  useEffect(() => {
    if (!id && new URLSearchParams(window.location.search).get("import") === "1") {
      setImportDialogOpen(true);
    }
    try {
      const flash = window.sessionStorage.getItem("know-me:post-flash");
      if (flash) {
        setMessage(flash);
        window.sessionStorage.removeItem("know-me:post-flash");
      }
    } catch {}
  }, [id]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const adaptView = (event?: MediaQueryListEvent) => {
      if (event?.matches ?? media.matches) setViewMode((current) => current === "split" ? "edit" : current);
    };
    adaptView();
    media.addEventListener("change", adaptView);
    return () => media.removeEventListener("change", adaptView);
  }, []);

  useEffect(() => {
    if (id) return;
    const snapshot = readLocalDraft();
    if (snapshot) setLocalDraft(snapshot);
  }, [id]);

  useEffect(() => {
    void requestJSON<{ tags: Array<{ name: string }>; categories: Array<{ name: string }> }>("/api/taxonomy")
      .then((payload) => setTaxonomy({
        tags: (payload.tags ?? []).map((item) => item.name),
        categories: (payload.categories ?? []).map((item) => item.name)
      }))
      .catch(() => undefined);
  }, []);

  async function loadPost() {
    if (!id) return;
    setLoaded(false);
    setError("");
    try {
      const [postPayload, revisionPayload] = await Promise.all([
        requestJSON<{ post: PostRecord }>("/api/posts/" + id),
        requestJSON<{ revisions: PostRevision[] }>("/api/posts/" + id + "/revisions")
      ]);
      const serverDraft = fromPost(postPayload.post);
      setDraft(serverDraft);
      setServerUpdatedAt(postPayload.post.updatedAt);
      setRevisions(revisionPayload.revisions ?? []);
      const snapshot = readLocalDraft(id);
      if (snapshot && JSON.stringify(snapshot.draft) !== JSON.stringify(serverDraft)) {
        setLocalDraft(snapshot);
      } else {
        setLocalDraft(null);
      }
      setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "post_failed");
      setLoaded(true);
    }
  }

  useEffect(() => { void loadPost(); }, [id]);

  useEffect(() => {
    if (!loaded || !dirty) return;
    const timer = window.setTimeout(() => {
      try {
        const snapshot: LocalDraftSnapshot = { draft, savedAt: Date.now(), baseUpdatedAt: serverUpdatedAt };
        window.localStorage.setItem(localDraftKey(id), JSON.stringify(snapshot));
      } catch {
        // Local draft protection is best-effort.
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, id, loaded, serverUpdatedAt]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypassBeforeUnloadRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") {
        event.preventDefault();
        if (!busy && draft.title.trim()) void save();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (!busy && draft.title.trim()) setPendingAction({ kind: "publish" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, draft]);

  function changeStatus(status: EditorState["status"]) {
    setDraft((current) => {
      let publishedAt = current.publishedAt;
      if (status === "draft") {
        publishedAt = "";
      } else if (status === "published" && current.status === "scheduled") {
        publishedAt = "";
      } else if (status === "scheduled") {
        const currentTime = publishedAt ? new Date(publishedAt).getTime() : 0;
        if (!currentTime || currentTime <= Date.now()) {
          publishedAt = localDateTimeInput(new Date(Date.now() + 60 * 60 * 1000));
        }
      }
      return { ...current, status, publishedAt };
    });
    setDirty(true);
    setMessage("");
    setError("");
  }

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

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const selectedEnd = end > start ? end : value.indexOf("\n", end);
    const lineEnd = selectedEnd === -1 ? value.length : selectedEnd;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const transformed = event.shiftKey
      ? lines.map((line) => line.startsWith("  ") ? line.slice(2) : line.startsWith("\t") ? line.slice(1) : line).join("\n")
      : lines.map((line) => "  " + line).join("\n");
    const next = value.slice(0, lineStart) + transformed + value.slice(lineEnd);
    const hasSelection = end > start;
    let cursor = start;
    if (!hasSelection) {
      if (event.shiftKey) {
        if (block.startsWith("  ")) cursor = Math.max(lineStart, start - 2);
        else if (block.startsWith("\t")) cursor = Math.max(lineStart, start - 1);
      } else {
        cursor = start + 2;
      }
    }
    update("contentMd", next);
    requestAnimationFrame(() => {
      textarea.focus();
      if (hasSelection) textarea.setSelectionRange(lineStart, lineStart + transformed.length);
      else textarea.setSelectionRange(cursor, cursor);
    });
  }

  async function uploadImage(file: File) {
    const validationError = validateMediaFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("alt", file.name.replace(/\.[^.]+$/, ""));
      const response = await requestAPI("/api/media", { method: "POST", body: form });
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

  function beginMarkdownImport(mode: MarkdownImportMode) {
    setImportMode(mode);
    setImportDialogOpen(false);
    window.setTimeout(() => importInputRef.current?.click(), 0);
  }

  async function importMarkdown(file: File, mode: MarkdownImportMode) {
    setError("");
    try {
      const text = await file.text();
      const parsed = parseMarkdownImport(text, mode);
      const fallbackTitle = file.name.replace(/\.md$/i, "");
      setDraft((current) => ({
        ...current,
        contentMd: parsed.contentMd,
        title: parsed.title ?? (current.title.trim() ? current.title : fallbackTitle),
        firstPublishedAt: parsed.firstPublishedAt
          ? localDateTimeInput(new Date(parsed.firstPublishedAt))
          : current.firstPublishedAt
      }));
      setDirty(true);
      setMessage(
        mode === "frontmatter"
          ? "Front Matter Markdown 已导入，标题和日期已解析"
          : "普通 Markdown 已导入"
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "markdown_import_failed");
    }
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
    const status = overrideStatus ?? draft.status;
    if (status === "scheduled" && !draft.publishedAt) {
      setError("scheduled_time_required");
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const publishNow = overrideStatus === "published" && draft.status !== "published";
      const publishedAt = publishNow ? null : draft.publishedAt ? new Date(draft.publishedAt).getTime() : null;
      const firstPublishedAt = draft.firstPublishedAt ? new Date(draft.firstPublishedAt).getTime() : null;
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
          firstPublishedAt,
          tags: splitNames(draft.tags),
          categories: splitNames(draft.categories)
        })
      });
      setDraft(fromPost(payload.post));
      setServerUpdatedAt(payload.post.updatedAt);
      setDirty(false);
      setLocalDraft(null);
      try { window.localStorage.removeItem(localDraftKey(id)); } catch {}
      setMessage(status === "published" ? "已发布" : "已保存");
      if (!id) {
        try { window.sessionStorage.setItem("know-me:post-flash", status === "published" ? "文章已发布" : "文章已保存"); } catch {}
        bypassBeforeUnloadRef.current = true;
        window.location.replace("/admin/posts/" + payload.post.id);
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
    if (!id) return;
    setBusy(true);
    try {
      const payload = await requestJSON<{ post: PostRecord; revisions: PostRevision[] }>("/api/posts/" + id + "/revisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revisionId })
      });
      setDraft(fromPost(payload.post));
      setServerUpdatedAt(payload.post.updatedAt);
      setRevisions(payload.revisions ?? []);
      setDirty(false);
      setLocalDraft(null);
      try { window.localStorage.removeItem(localDraftKey(id)); } catch {}
      setPendingAction(null);
      setMessage("历史版本已恢复");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "restore_failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) return;
    setBusy(true);
    try {
      await requestJSON("/api/posts/" + id, { method: "DELETE" });
      try { window.localStorage.removeItem(localDraftKey(id)); } catch {}
      try { window.sessionStorage.setItem("know-me:post-list-flash", "文章已删除"); } catch {}
      bypassBeforeUnloadRef.current = true;
      window.location.href = "/admin/posts";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "delete_failed");
      setBusy(false);
    }
  }

  const stats = useMemo(() => contentStats(draft.contentMd), [draft.contentMd]);
  const revisionDiff = useMemo(() => previewRevision ? diffLines(draft.contentMd, previewRevision.contentMd) : [], [draft.contentMd, previewRevision]);
  const localDraftConflict = Boolean(localDraft && id && localDraft.baseUpdatedAt > 0 && serverUpdatedAt > localDraft.baseUpdatedAt);
  const localDraftDiff = useMemo(() => localDraft ? diffLines(draft.contentMd, localDraft.draft.contentMd) : [], [draft.contentMd, localDraft]);

  if (!loaded) return <LoadingCard text="正在加载文章…" />;
  if (error && !draft.title && id) return <ErrorCard message={error} onRetry={() => void loadPost()} />;

  return (
    <>
      <AdminTitle
        eyebrow="EDITOR"
        title={id ? "编辑文章" : "新建文章"}
        description="Markdown 为主，支持实时预览、自动历史版本和发布状态。"
      />
      {localDraft ? (
        <section className={"km-panel km-local-draft-banner" + (localDraftConflict ? " is-conflict" : "")}>
          <div>
            <strong>{localDraftConflict ? "本地草稿基于较旧的服务器版本" : "发现未保存的本地草稿"}</strong>
            <span>
              {new Date(localDraft.savedAt).toLocaleString("zh-CN")} · 浏览器本地自动保护
              {localDraftConflict ? " · 服务器内容后来又被更新过，建议先对比再恢复" : ""}
            </span>
          </div>
          <div>
            {localDraftConflict ? <button type="button" className="dk-button" onClick={() => setLocalDraftPreviewOpen(true)}>对比差异</button> : null}
            <button type="button" className="dk-button" onClick={() => {
              try { window.localStorage.removeItem(localDraftKey(id)); } catch {}
              setLocalDraft(null);
              setLocalDraftPreviewOpen(false);
            }}>{localDraftConflict ? "保留服务器版本" : "丢弃本地草稿"}</button>
            <button type="button" className="dk-button dk-button-primary" onClick={() => {
              setDraft(localDraft.draft);
              setDirty(true);
              setLocalDraft(null);
              setLocalDraftPreviewOpen(false);
              setMessage("已恢复本地草稿，保存后才会写入服务器");
            }}>恢复本地草稿</button>
          </div>
        </section>
      ) : null}
      <form className={"km-editor-layout" + (focusMode ? " is-focus" : "")} onSubmit={(event) => void save(event)}>
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
            <button type="button" onClick={() => setImportDialogOpen(true)}>导入 MD</button>
            <button type="button" onClick={exportMarkdown}>导出 MD</button>
            <button type="button" onClick={() => setPreviewOpen(true)}>整页预览</button>
            <button type="button" className={focusMode ? "is-active" : ""} aria-pressed={focusMode} onClick={() => setFocusMode((value) => !value)}>{focusMode ? "显示属性" : "专注编辑"}</button>
            <div className="km-editor-view-switch" role="group" aria-label="正文视图">
              <button type="button" className={"km-view-split " + (viewMode === "split" ? "is-active" : "")} aria-pressed={viewMode === "split"} onClick={() => setViewMode("split")}>并排</button>
              <button type="button" className={viewMode === "edit" ? "is-active" : ""} aria-pressed={viewMode === "edit"} onClick={() => setViewMode("edit")}>仅编辑</button>
              <button type="button" className={viewMode === "preview" ? "is-active" : ""} aria-pressed={viewMode === "preview"} onClick={() => setViewMode("preview")}>仅预览</button>
            </div>
            <input ref={mediaInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadImage(file); e.currentTarget.value = ""; }} />
            <input ref={importInputRef} hidden type="file" accept=".md,text/markdown,text/plain" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importMarkdown(file, importMode); e.currentTarget.value = ""; }} />
          </div>

          <div className={"km-editor-split is-" + viewMode}>
            <label className="km-editor-source">
              <span title={`中文 ${stats.cjkCharacters} 字 · 英文 ${stats.latinWords} 词`}>Markdown · {stats.totalCharacters} 字符 · 约 {stats.readingMinutes} 分钟</span>
              <textarea
                ref={textareaRef}
                value={draft.contentMd}
                onChange={(e) => update("contentMd", e.target.value)}
                onKeyDown={handleEditorKeyDown}
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
                  <MarkdownRenderer source={draft.contentMd} documentTitle={draft.title} />
                ) : <p className="km-muted">这里会实时显示 Markdown 预览。</p>}
              </article>
            </div>
          </div>
        </section>

        <aside className="km-editor-side">
          <details className="km-panel km-editor-settings km-editor-disclosure" open>
            <summary><span>发布</span><small>{draft.status === "published" ? "已发布" : draft.status === "scheduled" ? "定时发布" : "草稿"}</small></summary>
            <div className="km-editor-disclosure-body">
              <label className="dk-field">状态
                <select value={draft.status} onChange={(e) => changeStatus(e.target.value as EditorState["status"])}>
                  <option value="draft">草稿</option>
                  <option value="published">已发布</option>
                  <option value="scheduled">定时发布</option>
                </select>
              </label>
              <label className="dk-field">首次发布时间
                <input type="datetime-local" value={draft.firstPublishedAt} onChange={(e) => update("firstPublishedAt", e.target.value)} />
                <small className="km-field-hint">首次发布时自动生成，也可手动调整；Front Matter 的 date 会导入到这里。</small>
              </label>
              {draft.status === "scheduled" ? (
                <label className="dk-field">发布时间
                  <input required type="datetime-local" value={draft.publishedAt} onChange={(e) => update("publishedAt", e.target.value)} />
                  {draft.publishedAt && new Date(draft.publishedAt).getTime() <= Date.now() ? <small className="km-field-warning">这个时间已过去，保存后文章会立即公开。</small> : <small className="km-field-hint">按当前设备时区设置。</small>}
                </label>
              ) : null}
              <label className="km-check"><input type="checkbox" checked={draft.pinned} onChange={(e) => update("pinned", e.target.checked)} /><span><strong>置顶文章</strong></span></label>
              <div className="km-editor-actions">
                <button className="dk-button dk-button-primary" disabled={busy || !draft.title.trim()}>{busy ? "保存中…" : "保存"}</button>
                <button type="button" className="dk-button" disabled={busy || !draft.title.trim()} onClick={() => setPendingAction({ kind: "publish" })}>保存并发布</button>
                {id && draft.status === "published" && draft.slug ? <a className="dk-button" href={"/blog/" + encodeURIComponent(draft.slug)} target="_blank" rel="noreferrer">查看文章</a> : null}
              </div>
              <small className="km-editor-autosave">{dirty ? "未保存修改会自动保护到本浏览器" : "服务器内容已同步"} · Ctrl/Cmd+S 保存 · Ctrl/Cmd+Enter 发布</small>
              {message ? <div className="dk-message">{message}</div> : null}
              {error ? <div className="dk-message is-danger">{errorText(error)}</div> : null}
            </div>
          </details>

          <details className="km-panel km-editor-settings km-editor-disclosure" open>
            <summary><span>分类与标签</span><small>{splitNames(draft.categories).length} 分类 · {splitNames(draft.tags).length} 标签</small></summary>
            <div className="km-editor-disclosure-body">
              <NameChips label="分类" value={draft.categories} suggestions={taxonomy.categories} onChange={(value) => update("categories", value)} />
              <NameChips label="标签" value={draft.tags} suggestions={taxonomy.tags} onChange={(value) => update("tags", value)} />
            </div>
          </details>

          <details className="km-panel km-editor-settings km-editor-disclosure" open>
            <summary><span>摘要与 SEO</span><small>{draft.excerpt.trim() ? "已填写摘要" : "摘要可留空自动生成"}</small></summary>
            <div className="km-editor-disclosure-body">
              <label className="dk-field">摘要<textarea rows={4} value={draft.excerpt} onChange={(e) => update("excerpt", e.target.value)} placeholder="留空自动生成" /></label>
              <label className="dk-field">SEO 标题<input value={draft.seoTitle} onChange={(e) => update("seoTitle", e.target.value)} /></label>
              <label className="dk-field">SEO 描述<textarea rows={3} value={draft.seoDescription} onChange={(e) => update("seoDescription", e.target.value)} /></label>
            </div>
          </details>

          {id ? (
            <details className="km-panel km-editor-settings km-editor-disclosure">
              <summary><span>历史版本</span><small>{revisions.length ? revisions.length + " 个可恢复版本" : "暂无可恢复版本"}</small></summary>
              <div className="km-editor-disclosure-body">
                <div className="km-revision-list">
                  {revisions.slice(0, 12).map((revision) => (
                    <button type="button" key={revision.id} onClick={() => setPreviewRevision(revision)}>
                      <span>{new Date(revision.createdAt).toLocaleString("zh-CN")}</span>
                      <small>{String(revision.metadata?.title ?? "历史版本")}</small>
                    </button>
                  ))}
                  {!revisions.length ? <small className="km-muted">暂时没有历史版本。</small> : null}
                </div>
              </div>
            </details>
          ) : null}

          <div className="km-editor-bottom-links">
            <a className="dk-button" href="/admin/posts">返回文章列表</a>
            {id ? <button type="button" className="dk-button km-danger-button" onClick={() => setPendingAction({ kind: "delete" })} disabled={busy}>删除文章</button> : null}
          </div>
        </aside>
        <div className="km-editor-mobile-actions">
          <span>{message || (dirty ? "有未保存修改" : "服务器内容已同步")}</span>
          <div>
            <button className="dk-button dk-button-primary" disabled={busy || !draft.title.trim()}>{busy ? "保存中…" : "保存"}</button>
            <button type="button" className="dk-button" disabled={busy || !draft.title.trim()} onClick={() => setPendingAction({ kind: "publish" })}>保存并发布</button>
          </div>
        </div>
      </form>
      {message ? <Toast message={message} onClose={() => setMessage("")} /> : null}
      {importDialogOpen ? (
        <div className="km-modal-backdrop" onMouseDown={() => setImportDialogOpen(false)}>
          <section className="km-panel km-import-markdown-dialog" role="dialog" aria-modal="true" aria-labelledby="km-import-markdown-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="km-eyebrow">IMPORT</span>
                <h2 id="km-import-markdown-title">选择 Markdown 类型</h2>
                <p>导入类型需要显式选择，避免把 YAML Front Matter 当成正文。</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setImportDialogOpen(false)}>×</button>
            </header>
            <div className="km-import-mode-grid">
              <button type="button" onClick={() => beginMarkdownImport("plain")}>
                <strong>普通 Markdown</strong>
                <span>整个文件作为正文导入；标题为空时使用文件名。</span>
              </button>
              <button type="button" onClick={() => beginMarkdownImport("frontmatter")}>
                <strong>YAML Front Matter Markdown</strong>
                <span>解析 title 和 date，并从正文中移除 --- 头信息。</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {localDraft && localDraftPreviewOpen ? (
        <div className="km-modal-backdrop" onMouseDown={() => setLocalDraftPreviewOpen(false)}>
          <section className="km-panel km-revision-preview" role="dialog" aria-modal="true" aria-labelledby="km-local-draft-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="km-eyebrow">LOCAL DRAFT</span>
                <h2 id="km-local-draft-preview-title">本地草稿与服务器内容差异</h2>
                <p>本地草稿保存于 {new Date(localDraft.savedAt).toLocaleString("zh-CN")}</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setLocalDraftPreviewOpen(false)}>×</button>
            </header>
            <div className="km-revision-meta">
              <div><span>本地标题</span><strong>{localDraft.draft.title || "未命名"}</strong></div>
              <div><span>服务器标题</span><strong>{draft.title || "未命名"}</strong></div>
            </div>
            <div className="km-revision-diff">
              {localDraftDiff.map((line, index) => (
                <div className={"is-" + line.type} key={index}>
                  <b>{line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}</b>
                  <code>{line.text || " "}</code>
                </div>
              ))}
              {!localDraftDiff.length ? <p className="km-muted">正文没有差异。</p> : null}
            </div>
            <footer>
              <button type="button" className="dk-button" onClick={() => {
                try { window.localStorage.removeItem(localDraftKey(id)); } catch {}
                setLocalDraft(null);
                setLocalDraftPreviewOpen(false);
              }}>保留服务器版本</button>
              <button type="button" className="dk-button dk-button-primary" onClick={() => {
                setDraft(localDraft.draft);
                setDirty(true);
                setLocalDraft(null);
                setLocalDraftPreviewOpen(false);
                setMessage("已恢复本地草稿，保存后才会写入服务器");
              }}>恢复本地草稿</button>
            </footer>
          </section>
        </div>
      ) : null}
      {previewOpen ? (
        <div className="km-modal-backdrop" onMouseDown={() => setPreviewOpen(false)}>
          <section className="km-panel km-post-page-preview" role="dialog" aria-modal="true" aria-labelledby="km-post-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span className="km-eyebrow">PREVIEW</span><h2>公开页面预览</h2></div>
              <button type="button" aria-label="关闭" onClick={() => setPreviewOpen(false)}>×</button>
            </header>
            <article>
              <div className="km-article-head">
                <span className="km-eyebrow">{splitNames(draft.categories)[0] || "ARTICLE"}</span>
                <h1 id="km-post-preview-title">{draft.title || "未命名文章"}</h1>
                {draft.excerpt ? <p>{draft.excerpt}</p> : null}
                <div className="km-post-meta"><span>{stats.readingMinutes} 分钟阅读</span><span>{stats.totalCharacters} 字符</span><span>{draft.status === "published" ? "已发布" : draft.status === "scheduled" ? "定时" : "草稿"}</span></div>
              </div>
              <div className="km-markdown">
                {draft.contentMd ? <MarkdownRenderer source={draft.contentMd} documentTitle={draft.title} /> : <p className="km-muted">暂无正文。</p>}
              </div>
              <div className="km-chip-row">{splitNames(draft.tags).map((tag) => <span key={tag}>{tag}</span>)}</div>
            </article>
          </section>
        </div>
      ) : null}
      {previewRevision ? (
        <div className="km-modal-backdrop" onMouseDown={() => { if (!busy) setPreviewRevision(null); }}>
          <section className="km-panel km-revision-preview" role="dialog" aria-modal="true" aria-labelledby="km-revision-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="km-eyebrow">REVISION</span>
                <h2 id="km-revision-preview-title">历史版本预览</h2>
                <p>{new Date(previewRevision.createdAt).toLocaleString("zh-CN")}</p>
              </div>
              <button type="button" aria-label="关闭" disabled={busy} onClick={() => setPreviewRevision(null)}>×</button>
            </header>
            <div className="km-revision-meta">
              <div><span>历史标题</span><strong>{String(previewRevision.metadata?.title ?? "未记录")}</strong></div>
              <div><span>当前标题</span><strong>{draft.title || "未命名"}</strong></div>
              <div><span>历史状态</span><strong>{String(previewRevision.metadata?.status ?? "draft")}</strong></div>
              <div><span>当前状态</span><strong>{draft.status}</strong></div>
            </div>
            <div className="km-revision-diff" aria-label="历史版本与当前内容差异">
              {revisionDiff.map((line, index) => (
                <div className={"is-" + line.type} key={index}>
                  <b>{line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}</b>
                  <code>{line.text || " "}</code>
                </div>
              ))}
              {!revisionDiff.length ? <p className="km-muted">内容没有差异。</p> : null}
            </div>
            <footer>
              <button type="button" className="dk-button" disabled={busy} onClick={() => setPreviewRevision(null)}>关闭</button>
              <button type="button" className="dk-button dk-button-primary" disabled={busy} onClick={() => {
                setPendingAction({ kind: "restore", revisionId: previewRevision.id });
                setPreviewRevision(null);
              }}>恢复此版本</button>
            </footer>
          </section>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={
          pendingAction?.kind === "delete" ? "删除这篇文章？" :
          pendingAction?.kind === "publish" ? "发布这篇文章？" :
          "恢复这个历史版本？"
        }
        description={
          pendingAction?.kind === "delete" ? "文章删除后不可撤销。" :
          pendingAction?.kind === "publish" ? "保存后文章会立即对公开 Blog 可见。未保存修改会一起发布。" :
          "当前内容会先自动形成新的历史版本，然后恢复所选版本。"
        }
        confirmLabel={
          pendingAction?.kind === "delete" ? "删除文章" :
          pendingAction?.kind === "publish" ? "确认发布" :
          "恢复版本"
        }
        danger={pendingAction?.kind === "delete"}
        busy={busy}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (pendingAction?.kind === "delete") void remove();
          else if (pendingAction?.kind === "restore") void restore(pendingAction.revisionId);
          else if (pendingAction?.kind === "publish") {
            setPendingAction(null);
            void save(undefined, "published");
          }
        }}
      />
    </>
  );
}
