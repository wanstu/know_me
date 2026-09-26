import { FormEvent, useEffect, useState } from "react";
import { requestJSON } from "../../api";
import { AdminTitle, ConfirmDialog, ErrorCard, LoadingCard, TextPromptDialog, Toast, errorText } from "../../ui";

export type TaxonomyDetail = { id: number; name: string; slug: string; count: number };
type Kind = "tag" | "category";
type Payload = { tags: TaxonomyDetail[]; categories: TaxonomyDetail[] };

export function TaxonomyManager() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [newTag, setNewTag] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingRename, setPendingRename] = useState<{ kind: Kind; item: TaxonomyDetail } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: Kind; item: TaxonomyDetail } | null>(null);
  const [pendingMerge, setPendingMerge] = useState<{ kind: Kind; item: TaxonomyDetail; targetId: number } | null>(null);

  async function load() {
    setData(await requestJSON<Payload>("/api/taxonomy"));
  }

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "taxonomy_failed")); }, []);

  async function action(
    actionName: "create" | "rename" | "delete" | "merge",
    kind: Kind,
    id?: number,
    name?: string,
    targetId?: number
  ) {
    setBusy(true);
    setError("");
    try {
      const payload = await requestJSON<Payload & { ok: true }>("/api/taxonomy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: actionName, kind, id, name, targetId })
      });
      setData({ tags: payload.tags, categories: payload.categories });
      setMessage(
        actionName === "create" ? "已新增" :
        actionName === "rename" ? "已重命名" :
        actionName === "merge" ? "已合并" : "已删除"
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "taxonomy_failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent, kind: Kind) {
    event.preventDefault();
    const value = (kind === "tag" ? newTag : newCategory).trim();
    if (!value) return;
    const ok = await action("create", kind, undefined, value);
    if (ok) {
      if (kind === "tag") setNewTag(""); else setNewCategory("");
    }
  }

  function rename(kind: Kind, item: TaxonomyDetail) {
    setPendingRename({ kind, item });
  }

  function remove(kind: Kind, item: TaxonomyDetail) {
    setPendingDelete({ kind, item });
  }

  function merge(kind: Kind, item: TaxonomyDetail) {
    const values = kind === "tag" ? data?.tags ?? [] : data?.categories ?? [];
    const target = values.find((value) => value.id !== item.id);
    if (!target) return;
    setPendingMerge({ kind, item, targetId: target.id });
  }

  async function confirmRename(value: string) {
    if (!pendingRename || value === pendingRename.item.name) {
      setPendingRename(null);
      return;
    }
    const ok = await action("rename", pendingRename.kind, pendingRename.item.id, value);
    if (ok) setPendingRename(null);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const ok = await action("delete", pendingDelete.kind, pendingDelete.item.id);
    if (ok) setPendingDelete(null);
  }

  async function confirmMerge() {
    if (!pendingMerge) return;
    const ok = await action("merge", pendingMerge.kind, pendingMerge.item.id, undefined, pendingMerge.targetId);
    if (ok) setPendingMerge(null);
  }

  if (!data) return error ? <ErrorCard message={error} onRetry={() => { setError(""); void load().catch((e) => setError(e instanceof Error ? e.message : "taxonomy_failed")); }} /> : <LoadingCard text="正在加载分类与标签…" />;

  return (
    <>
      <AdminTitle eyebrow="TAXONOMY" title="分类与标签" description="支持新增、重命名、合并与删除；文章关联会随重命名和合并自动保留。" />
      {error ? <div className="dk-message is-danger">{errorText(error)}</div> : null}
      <div className="km-two-columns">
        <TaxonomyColumn
          title="分类"
          values={data.categories}
          value={newCategory}
          setValue={setNewCategory}
          onSubmit={(event) => void create(event, "category")}
          onRename={(item) => rename("category", item)}
          onMerge={(item) => merge("category", item)}
          onDelete={(item) => remove("category", item)}
          busy={busy}
        />
        <TaxonomyColumn
          title="标签"
          values={data.tags}
          value={newTag}
          setValue={setNewTag}
          onSubmit={(event) => void create(event, "tag")}
          onRename={(item) => rename("tag", item)}
          onMerge={(item) => merge("tag", item)}
          onDelete={(item) => remove("tag", item)}
          busy={busy}
        />
      </div>

      <TextPromptDialog
        open={Boolean(pendingRename)}
        title={pendingRename ? "重命名“" + pendingRename.item.name + "”" : "重命名"}
        label="新的名称"
        initialValue={pendingRename?.item.name ?? ""}
        busy={busy}
        onCancel={() => setPendingRename(null)}
        onConfirm={(value) => void confirmRename(value)}
      />

      {pendingMerge ? (
        <div className="km-modal-backdrop" onMouseDown={() => { if (!busy) setPendingMerge(null); }}>
          <section className="km-panel km-taxonomy-merge-dialog" role="dialog" aria-modal="true" aria-labelledby="km-taxonomy-merge-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="km-eyebrow">MERGE</span>
                <h2 id="km-taxonomy-merge-title">合并“{pendingMerge.item.name}”</h2>
              </div>
              <button type="button" aria-label="关闭" disabled={busy} onClick={() => setPendingMerge(null)}>×</button>
            </header>
            <p>
              源{pendingMerge.kind === "tag" ? "标签" : "分类"}的文章关联会迁移到目标项；
              已同时关联目标项的文章会自动去重，之后删除源项。
            </p>
            <label className="dk-field">合并到
              <select value={pendingMerge.targetId} onChange={(event) => setPendingMerge({ ...pendingMerge, targetId: Number(event.target.value) })}>
                {(pendingMerge.kind === "tag" ? data.tags : data.categories)
                  .filter((item) => item.id !== pendingMerge.item.id)
                  .map((item) => <option value={item.id} key={item.id}>{item.name} · {item.count} 篇</option>)}
              </select>
            </label>
            <footer>
              <button type="button" className="dk-button" disabled={busy} onClick={() => setPendingMerge(null)}>取消</button>
              <button type="button" className="dk-button dk-button-primary" disabled={busy} onClick={() => void confirmMerge()}>{busy ? "合并中…" : "确认合并"}</button>
            </footer>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete ? "删除“" + pendingDelete.item.name + "”？" : "确认删除"}
        description="文章本身不会删除，但会移除对应的分类或标签关联。"
        confirmLabel="删除"
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
      {message ? <Toast message={message} onClose={() => setMessage("")} /> : null}
    </>
  );
}

function TaxonomyColumn({
  title,
  values,
  value,
  setValue,
  onSubmit,
  onRename,
  onMerge,
  onDelete,
  busy
}: {
  title: string;
  values: TaxonomyDetail[];
  value: string;
  setValue: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onRename: (item: TaxonomyDetail) => void;
  onMerge: (item: TaxonomyDetail) => void;
  onDelete: (item: TaxonomyDetail) => void;
  busy: boolean;
}) {
  return (
    <section className="km-panel km-taxonomy-panel">
      <header><div><span className="km-eyebrow">MANAGE</span><h2>{title}</h2></div><strong>{values.length}</strong></header>
      <form className="km-taxonomy-create" onSubmit={onSubmit}>
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={"新增" + title.slice(0, 2)} />
        <button className="dk-button dk-button-primary" disabled={busy || !value.trim()}>新增</button>
      </form>
      <div className="km-taxonomy-list">
        {values.map((item) => (
          <div key={item.id}>
            <span><strong>{item.name}</strong><small>{item.slug}</small></span>
            <b>{item.count}</b>
            <button type="button" onClick={() => onRename(item)}>重命名</button>
            <button type="button" disabled={values.length < 2} onClick={() => onMerge(item)}>合并</button>
            <button type="button" onClick={() => onDelete(item)}>删除</button>
          </div>
        ))}
        {!values.length ? <p className="km-muted">暂无内容。</p> : null}
      </div>
    </section>
  );
}
