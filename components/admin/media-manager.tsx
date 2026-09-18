"use client";

import { useState } from "react";
import type { MediaRecord } from "@/lib/media/repository";

export function MediaManager({ initialMedia }: { initialMedia: MediaRecord[] }) {
  const [media, setMedia] = useState(initialMedia);
  const [message, setMessage] = useState("");

  async function upload(file: File | null) {
    if (!file) return;
    setMessage("正在上传…");
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/media", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "上传失败");
      return;
    }
    setMedia((current) => [payload.media, ...current]);
    setMessage("上传完成，可在 Markdown 中使用 " + payload.media.url);
  }

  async function remove(item: MediaRecord) {
    if (!window.confirm("删除媒体“" + item.originalName + "”？已引用它的文章图片会失效。")) return;
    const response = await fetch("/api/media/" + item.id, { method: "DELETE" });
    if (response.ok) setMedia((current) => current.filter((value) => value.id !== item.id));
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText("![](" + url + ")");
    setMessage("已复制 Markdown 图片语法");
  }

  return (
    <>
      <div className="media-toolbar">
        <label className="file-picker">
          <span>＋ 上传图片</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              void upload(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {message ? <span className="muted">{message}</span> : null}
      </div>

      <div className="media-grid">
        {media.map((item) => (
          <article className="media-card" key={item.id}>
            <div className="media-thumb"><img src={item.url} alt={item.alt || item.originalName} /></div>
            <div className="media-card-copy">
              <strong>{item.originalName}</strong>
              <small>{Math.max(1, Math.round(item.size / 1024))} KB · {item.mime}</small>
            </div>
            <div className="media-card-actions">
              <button type="button" onClick={() => void copy(item.url)}>复制 Markdown</button>
              <button type="button" className="danger-text" onClick={() => void remove(item)}>删除</button>
            </div>
          </article>
        ))}
        {media.length === 0 ? <div className="admin-empty">还没有媒体。编辑 Markdown 时可以直接粘贴图片，也可以在这里上传。</div> : null}
      </div>
    </>
  );
}
