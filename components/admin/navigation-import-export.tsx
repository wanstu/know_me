"use client";

import { useState } from "react";
import Link from "next/link";

type ImportPreview = {
  groups: number;
  items: number;
  folders: number;
  browserLocal: number;
  conflicts: number;
};

export function NavigationImportExport() {
  const [raw, setRaw] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function chooseFile(file: File | null) {
    setPreview(null);
    setMessage("");
    if (!file) {
      setRaw("");
      setName("");
      return;
    }

    const text = await file.text();
    setRaw(text);
    setName(file.name);

    setBusy(true);
    try {
      const response = await fetch("/api/navigation/import/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw: text })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "导入文件解析失败");
      setPreview(payload.preview);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入文件解析失败");
    } finally {
      setBusy(false);
    }
  }

  async function apply(strategy: "merge" | "replace") {
    if (!raw) return;
    if (strategy === "replace" && !window.confirm("替换会先删除现有全部导航数据，确定继续？")) return;

    setBusy(true);
    setMessage("正在导入…");
    try {
      const response = await fetch("/api/navigation/import/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw, strategy, overwrite })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "导入失败");

      setMessage(
        "导入完成：新增 " + payload.result.addedGroups + " 个分组、" +
        payload.result.addedItems + " 个导航项；更新 " +
        payload.result.updatedItems + " 个导航项。"
      );
      setPreview(null);
      setRaw("");
      setName("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import-export-layout">
      <section className="admin-panel import-export-card">
        <div className="import-export-head">
          <div>
            <div className="eyebrow">Export</div>
            <h2>导出 iTab 备份</h2>
            <p className="muted">导出当前导航分组、链接、文件夹、尺寸、颜色以及可兼容的 iTab 字段。</p>
          </div>
          <a className="primary-button" href="/api/navigation/export">下载 .itabdata</a>
        </div>
      </section>

      <section className="admin-panel import-export-card">
        <div>
          <div className="eyebrow">Import</div>
          <h2>导入 iTab 数据</h2>
          <p className="muted">先预览数据，再选择合并或完全替换。浏览器内部地址会保留，但能否直接打开取决于浏览器权限。</p>
        </div>

        <label className="file-picker import-export-picker">
          <span>{busy ? "处理中…" : "选择 .itabdata 文件"}</span>
          <input
            type="file"
            accept=".itabdata,application/json"
            disabled={busy}
            onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
          />
        </label>

        {name ? <p className="muted">已选择：{name}</p> : null}

        {preview ? (
          <>
            <div className="import-preview import-preview--standalone">
              <div><span>分组</span><strong>{preview.groups}</strong></div>
              <div><span>导航项</span><strong>{preview.items}</strong></div>
              <div><span>文件夹</span><strong>{preview.folders}</strong></div>
              <div><span>浏览器内部地址</span><strong>{preview.browserLocal}</strong></div>
              <div><span>冲突</span><strong>{preview.conflicts}</strong></div>
            </div>

            <div className="import-export-actions">
              <label>
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(event) => setOverwrite(event.target.checked)}
                />
                合并时用导入数据覆盖冲突项
              </label>
              <div>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void apply("merge")}>
                  合并导入
                </button>
                <button type="button" className="danger-button" disabled={busy} onClick={() => void apply("replace")}>
                  替换全部
                </button>
              </div>
            </div>
          </>
        ) : null}

        {message ? <p className="admin-message">{message}</p> : null}
      </section>

      <section className="admin-panel import-export-note">
        <div>
          <strong>导入完成后</strong>
          <p className="muted">可以回到起始页管理继续整理分组、排序和可见性。</p>
        </div>
        <Link href="/admin/navigation" className="secondary-button">返回起始页管理</Link>
      </section>
    </div>
  );
}
