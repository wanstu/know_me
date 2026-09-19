import { FormEvent, useEffect, useState } from "react";
import { requestJSON } from "../../api";
import type { MediaRecord } from "../../types";
import { AdminTitle, ErrorCard, LoadingCard } from "../../ui";

export function MediaManager() {
  const [media, setMedia] = useState<MediaRecord[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [alt, setAlt] = useState("");
  const [file, setFile] = useState<File | null>(null);

  async function load() {
    const payload = await requestJSON<{ media: MediaRecord[] }>("/api/media");
    setMedia(payload.media ?? []);
  }

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "media_failed")); }, []);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData();
    form.set("file", file);
    form.set("alt", alt);
    try {
      const response = await fetch("/api/media", { method: "POST", body: form, credentials: "same-origin" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "upload_failed");
      setFile(null);
      setAlt("");
      setMessage("上传完成");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload_failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: MediaRecord) {
    if (!window.confirm(`删除媒体“${item.originalName}”？已经写进文章 Markdown 的链接不会自动移除。`)) return;
    setBusy(true);
    setError("");
    try {
      await requestJSON("/api/media/" + item.id, { method: "DELETE" });
      setMedia((current) => current?.filter((value) => value.id !== item.id) ?? []);
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
      window.prompt("复制媒体地址", value);
    }
  }

  if (!media) return error ? <ErrorCard message={error} /> : <LoadingCard text="正在加载媒体库…" />;

  return (
    <>
      <AdminTitle eyebrow="MEDIA" title="媒体库" description="上传图片后可以直接复制 URL 或 Markdown，在文章编辑器中使用。" />
      <section className="km-panel km-media-upload">
        <form onSubmit={(e) => void upload(e)}>
          <label className="km-upload-drop">
            <input
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <span>{file ? file.name : "选择 JPEG / PNG / WebP / GIF"}</span>
            <small>最大 10 MB</small>
          </label>
          <label className="dk-field">Alt 文本<input value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="描述图片内容" /></label>
          <button className="dk-button dk-button-primary" disabled={!file || busy}>{busy ? "处理中…" : "上传图片"}</button>
        </form>
        {message ? <div className="dk-message">{message}</div> : null}
        {error ? <div className="dk-message is-danger">{error}</div> : null}
      </section>

      <div className="km-media-grid km-media-grid-manage">
        {media.map((item) => (
          <figure className="km-panel" key={item.id}>
            <img src={item.url} alt={item.alt || item.originalName} />
            <figcaption>
              <strong title={item.originalName}>{item.originalName}</strong>
              <small>{Math.ceil(item.size / 1024)} KB · {item.mime}</small>
              <div>
                <button onClick={() => void copy(item.url)}>复制 URL</button>
                <button onClick={() => void copy(`![${item.alt || item.originalName}](${item.url})`)}>复制 Markdown</button>
                <button className="is-danger" onClick={() => void remove(item)}>删除</button>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
      {!media.length ? <section className="km-panel km-empty">媒体库还是空的。</section> : null}
    </>
  );
}
