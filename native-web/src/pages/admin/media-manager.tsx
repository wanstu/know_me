import { FormEvent, useEffect, useMemo, useState } from "react";
import { requestAPI, requestJSON } from "../../api";
import { validateMediaFile } from "../../media";
import type { MediaRecord } from "../../types";
import { AdminTitle, ErrorCard, LoadingCard, TextPromptDialog, Toast, errorText } from "../../ui";

type MediaSort = "newest" | "oldest" | "largest" | "name";
type MediaReference = { kind: "post" | "setting" | "navigation" | string; title: string; url: string };
type UploadFileState = { status: "waiting" | "uploading" | "success" | "error"; error?: string };

const MAX_UPLOAD_QUEUE = 50;

function uploadFileKey(file: File) {
  return file.name + "|" + file.size + "|" + file.lastModified;
}

export function MediaManager() {
  const [media, setMedia] = useState<MediaRecord[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadStates, setUploadStates] = useState<Record<string, UploadFileState>>({});
  const [alt, setAlt] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MediaSort>("newest");
  const [altDrafts, setAltDrafts] = useState<Record<number, string>>({});
  const [pendingDelete, setPendingDelete] = useState<MediaRecord | null>(null);
  const [deleteReferences, setDeleteReferences] = useState<MediaReference[] | null>(null);
  const [manualCopy, setManualCopy] = useState("");

  async function load() {
    const payload = await requestJSON<{ media: MediaRecord[] }>("/api/media");
    setMedia(payload.media ?? []);
  }

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "media_failed")); }, []);

  const filtered = useMemo(() => {
    if (!media) return [];
    const needle = query.trim().toLocaleLowerCase();
    const result = media.filter((item) => {
      if (!needle) return true;
      return [item.originalName, item.alt, item.mime, item.storageKey]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
    result.sort((a, b) => {
      if (sort === "oldest") return a.createdAt - b.createdAt;
      if (sort === "largest") return b.size - a.size;
      if (sort === "name") return a.originalName.localeCompare(b.originalName, "zh-CN");
      return b.createdAt - a.createdAt;
    });
    return result;
  }, [media, query, sort]);

  function addFiles(next: File[]) {
    setError("");
    let unsupported = 0;
    let oversized = 0;
    let duplicated = 0;

    const accepted = next.filter((file) => {
      const code = validateMediaFile(file);
      if (code === "unsupported_media_type") {
        unsupported++;
        return false;
      }
      if (code === "media_size_invalid") {
        oversized++;
        return false;
      }
      return true;
    });

    const seen = new Set(files.map(uploadFileKey));
    const unique = accepted.filter((file) => {
      const key = uploadFileKey(file);
      if (seen.has(key)) {
        duplicated++;
        return false;
      }
      seen.add(key);
      return true;
    });
    const capacity = Math.max(0, MAX_UPLOAD_QUEUE - files.length);
    const additions = unique.slice(0, capacity);
    const overflow = Math.max(0, unique.length - additions.length);

    const ignored: string[] = [];
    if (unsupported) ignored.push(`${unsupported} 个格式不支持`);
    if (oversized) ignored.push(`${oversized} 个为空或超过 10 MB`);
    if (duplicated) ignored.push(`${duplicated} 个已在队列中`);
    if (overflow) ignored.push(`${overflow} 个超过 50 张队列上限`);
    if (ignored.length) setError("已忽略：" + ignored.join("；") + "。");

    if (!additions.length) return;
    setFiles((current) => [...current, ...additions].slice(0, MAX_UPLOAD_QUEUE));
    setUploadStates((states) => {
      const nextStates = { ...states };
      for (const file of additions) nextStates[uploadFileKey(file)] = { status: "waiting" };
      return nextStates;
    });
  }

  function removeQueuedFile(index: number) {
    const file = files[index];
    if (!file) return;
    const key = uploadFileKey(file);
    setFiles((current) => current.filter((_, i) => i !== index));
    setUploadStates((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function clearQueue() {
    setFiles([]);
    setUploadStates({});
    setAlt("");
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    const targets = files.filter((file) => uploadStates[uploadFileKey(file)]?.status !== "success");
    if (!targets.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    const uploaded: MediaRecord[] = [];
    let failed = 0;

    for (const file of targets) {
      const key = uploadFileKey(file);
      setUploadStates((current) => ({ ...current, [key]: { status: "uploading" } }));
      try {
        const form = new FormData();
        form.set("file", file);
        form.set("alt", files.length === 1 && alt.trim() ? alt.trim() : file.name.replace(/\.[^.]+$/, ""));
        const response = await requestAPI("/api/media", { method: "POST", body: form });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "upload_failed");
        uploaded.push(payload.media as MediaRecord);
        setUploadStates((current) => ({ ...current, [key]: { status: "success" } }));
      } catch (e) {
        failed++;
        const code = e instanceof Error ? e.message : "upload_failed";
        setUploadStates((current) => ({ ...current, [key]: { status: "error", error: code } }));
      }
    }

    if (uploaded.length) {
      setMedia((current) => [...uploaded.reverse(), ...(current ?? [])]);
    }
    if (failed) {
      setMessage(`上传完成：成功 ${uploaded.length} 张，失败 ${failed} 张；失败项可直接重试。`);
    } else {
      setMessage(`已上传 ${uploaded.length} 张图片`);
      setAlt("");
    }
    setBusy(false);
  }

  async function saveAlt(item: MediaRecord) {
    const nextAlt = (altDrafts[item.id] ?? item.alt).trim();
    setBusy(true);
    setError("");
    try {
      const payload = await requestJSON<{ media: MediaRecord }>("/api/media/" + item.id, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alt: nextAlt })
      });
      setMedia((current) => current?.map((value) => value.id === item.id ? payload.media : value) ?? []);
      setAltDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setMessage("Alt 文本已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : "media_failed");
    } finally {
      setBusy(false);
    }
  }

  async function inspectReferences(item: MediaRecord) {
    setBusy(true);
    setError("");
    setPendingDelete(item);
    setDeleteReferences(null);
    try {
      const payload = await requestJSON<{ references: MediaReference[] }>("/api/media/" + item.id + "/references");
      setDeleteReferences(payload.references ?? []);
    } catch (e) {
      setPendingDelete(null);
      setError(e instanceof Error ? e.message : "media_reference_failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: MediaRecord) {
    setBusy(true);
    setError("");
    try {
      await requestJSON("/api/media/" + item.id, { method: "DELETE" });
      setMedia((current) => current?.filter((value) => value.id !== item.id) ?? []);
      setPendingDelete(null);
      setDeleteReferences(null);
      setMessage("已删除");
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete_failed");
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("地址已复制");
    } catch {
      setManualCopy(value);
    }
  }

  if (!media) return error ? <ErrorCard message={error} onRetry={() => { setError(""); void load().catch((e) => setError(e instanceof Error ? e.message : "media_failed")); }} /> : <LoadingCard text="正在加载媒体库…" />;

  return (
    <>
      <AdminTitle eyebrow="MEDIA" title="媒体库" description="上传、查找和维护站点图片；可直接复制 URL 或 Markdown。" />

      <section className="km-panel km-media-upload">
        <form onSubmit={(event) => void upload(event)}>
          <label
            className={"km-upload-drop" + (files.length ? " has-files" : "")}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              addFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <input
              hidden
              multiple
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(event) => addFiles(Array.from(event.target.files ?? []))}
            />
            <span>{files.length ? `已选择 ${files.length} 张图片` : "点击选择或拖入 JPEG / PNG / WebP / GIF"}</span>
            <small>单张最大 10 MB · 一次最多选择 50 张</small>
          </label>
          <label className="dk-field">Alt 文本（单图）<input disabled={files.length !== 1} value={alt} onChange={(event) => setAlt(event.target.value)} placeholder={files.length === 1 ? "描述图片内容；留空使用文件名" : "多图上传时自动使用文件名"} /></label>
          <button className="dk-button dk-button-primary" disabled={!files.some((file) => uploadStates[uploadFileKey(file)]?.status !== "success") || busy}>
            {busy ? "上传中…" : files.some((file) => uploadStates[uploadFileKey(file)]?.status === "error") ? "重试失败项" : `上传${files.length ? " " + files.length + " 张" : ""}`}
          </button>
        </form>
        {files.length ? (
          <div className="km-upload-queue">
            {files.slice(0, 12).map((file, index) => {
              const state = uploadStates[uploadFileKey(file)] ?? { status: "waiting" as const };
              const label = state.status === "uploading" ? "上传中" : state.status === "success" ? "成功" : state.status === "error" ? "失败" : "等待";
              return (
                <span key={uploadFileKey(file)} className={"is-" + state.status} title={state.error ? errorText(state.error) : file.name}>
                  <strong>{file.name}</strong>
                  <em>{label}</em>
                  <button type="button" aria-label={"移除“" + file.name + "”"} title="移除" disabled={busy} onClick={() => removeQueuedFile(index)}>×</button>
                </span>
              );
            })}
            {files.length > 12 ? <small>还有 {files.length - 12} 张</small> : null}
            {!busy ? <button type="button" onClick={clearQueue}>清空</button> : null}
          </div>
        ) : null}
        {error ? <div className="dk-message is-danger">{errorText(error)}</div> : null}
      </section>

      <div className="km-panel km-media-filter">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名、Alt、类型…" />
        <select value={sort} onChange={(event) => setSort(event.target.value as MediaSort)}>
          <option value="newest">最新上传</option>
          <option value="oldest">最早上传</option>
          <option value="largest">文件最大</option>
          <option value="name">按名称</option>
        </select>
        <span>{filtered.length} / {media.length}</span>
      </div>

      <div className="km-media-grid km-media-grid-manage">
        {filtered.map((item) => {
          const altValue = altDrafts[item.id] ?? item.alt;
          const altDirty = altValue !== item.alt;
          return (
            <figure className="km-panel" key={item.id}>
              <img src={item.url} alt={item.alt || item.originalName} />
              <figcaption>
                <strong title={item.originalName}>{item.originalName}</strong>
                <small>{Math.ceil(item.size / 1024)} KB · {item.mime}{item.width > 0 && item.height > 0 ? ` · ${item.width}×${item.height}` : ""}</small>
                <small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small>
                <div className="km-media-alt-edit">
                  <input value={altValue} onChange={(event) => setAltDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Alt 文本" />
                  <button disabled={busy || !altDirty} onClick={() => void saveAlt(item)}>保存 Alt</button>
                </div>
                <div>
                  <button onClick={() => void copy(item.url)}>复制 URL</button>
                  <button onClick={() => void copy(`![${item.alt || item.originalName}](${item.url})`)}>复制 Markdown</button>
                  <button className="is-danger" onClick={() => void inspectReferences(item)}>删除</button>
                </div>
              </figcaption>
            </figure>
          );
        })}
      </div>
      {!filtered.length ? (
        <section className="km-panel km-empty">
          <strong>{media.length ? "没有匹配的媒体" : "媒体库还是空的"}</strong>
          <p>{media.length ? "换个关键词，或者清除当前筛选后再找。" : "从上方上传区域选择或拖入第一张图片。"}</p>
          <div className="km-empty-actions">
            {media.length ? (
              <button type="button" className="dk-button" onClick={() => { setQuery(""); setSort("newest"); }}>清除筛选</button>
            ) : (
              <button
                type="button"
                className="dk-button dk-button-primary"
                onClick={() => document.querySelector<HTMLInputElement>('.km-upload-drop input[type="file"]')?.click()}
              >
                选择图片
              </button>
            )}
          </div>
        </section>
      ) : null}
      <TextPromptDialog
        open={Boolean(manualCopy)}
        title="手动复制媒体地址"
        label="媒体地址"
        initialValue={manualCopy}
        confirmLabel="关闭"
        onCancel={() => setManualCopy("")}
        onConfirm={() => setManualCopy("")}
      />
      {pendingDelete ? (
        <div className="km-modal-backdrop" onMouseDown={() => { if (!busy) { setPendingDelete(null); setDeleteReferences(null); } }}>
          <section className="km-panel km-media-reference-dialog" role="dialog" aria-modal="true" aria-labelledby="km-media-delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span className="km-eyebrow">DELETE MEDIA</span><h2 id="km-media-delete-title">删除媒体“{pendingDelete.originalName}”？</h2></div>
              <button type="button" aria-label="关闭" disabled={busy} onClick={() => { setPendingDelete(null); setDeleteReferences(null); }}>×</button>
            </header>
            {deleteReferences === null ? <LoadingCard text="正在检查媒体引用…" /> : deleteReferences.length ? (
              <>
                <div className="dk-message is-danger">这个媒体正在被 {deleteReferences.length} 处内容使用。删除后这些位置不会自动修复。</div>
                <div className="km-media-reference-list">
                  {deleteReferences.map((reference, index) => (
                    <a key={reference.kind + reference.title + index} href={reference.url}>
                      <span>{reference.kind === "post" ? "文章" : reference.kind === "setting" ? "站点设置" : reference.kind === "navigation" ? "导航" : "引用"}</span>
                      <strong>{reference.title}</strong>
                      <b>查看 ›</b>
                    </a>
                  ))}
                </div>
              </>
            ) : <div className="dk-message">没有检测到文章、站点背景/头像或导航图标引用这个媒体。</div>}
            <footer>
              <button type="button" className="dk-button" disabled={busy} onClick={() => { setPendingDelete(null); setDeleteReferences(null); }}>取消</button>
              <button type="button" className="dk-button km-danger-button" disabled={busy || deleteReferences === null} onClick={() => void remove(pendingDelete)}>{busy ? "删除中…" : deleteReferences?.length ? "仍然删除" : "删除"}</button>
            </footer>
          </section>
        </div>
      ) : null}
      {message ? <Toast message={message} onClose={() => setMessage("")} /> : null}
    </>
  );
}
