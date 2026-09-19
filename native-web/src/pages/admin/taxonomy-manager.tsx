import { FormEvent, useEffect, useState } from "react";
import { requestJSON } from "../../api";
import { AdminTitle, ErrorCard, LoadingCard } from "../../ui";

export type TaxonomyDetail = { id: number; name: string; slug: string; count: number };
type Kind = "tag" | "category";
type Payload = { tags: TaxonomyDetail[]; categories: TaxonomyDetail[] };

export function TaxonomyManager() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [newTag, setNewTag] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setData(await requestJSON<Payload>("/api/taxonomy"));
  }

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "taxonomy_failed")); }, []);

  async function action(action: "create" | "rename" | "delete", kind: Kind, id?: number, name?: string) {
    setBusy(true);
    setError("");
    try {
      const payload = await requestJSON<Payload & { ok: true }>("/api/taxonomy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, kind, id, name })
      });
      setData({ tags: payload.tags, categories: payload.categories });
    } catch (e) {
      setError(e instanceof Error ? e.message : "taxonomy_failed");
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent, kind: Kind) {
    event.preventDefault();
    const value = (kind === "tag" ? newTag : newCategory).trim();
    if (!value) return;
    await action("create", kind, undefined, value);
    if (kind === "tag") setNewTag(""); else setNewCategory("");
  }

  function rename(kind: Kind, item: TaxonomyDetail) {
    const value = window.prompt("新的名称", item.name)?.trim();
    if (!value || value === item.name) return;
    void action("rename", kind, item.id, value);
  }

  function remove(kind: Kind, item: TaxonomyDetail) {
    if (!window.confirm(`删除“${item.name}”？文章本身不会删除。`)) return;
    void action("delete", kind, item.id);
  }

  if (!data) return error ? <ErrorCard message={error} /> : <LoadingCard text="正在加载分类与标签…" />;

  return (
    <>
      <AdminTitle eyebrow="TAXONOMY" title="分类与标签" description="独立管理分类与标签；重命名会保留文章关联。" />
      {error ? <div className="dk-message is-danger">{error}</div> : null}
      <div className="km-two-columns">
        <TaxonomyColumn
          title="分类"
          values={data.categories}
          value={newCategory}
          setValue={setNewCategory}
          onSubmit={(e) => void create(e, "category")}
          onRename={(item) => rename("category", item)}
          onDelete={(item) => remove("category", item)}
          busy={busy}
        />
        <TaxonomyColumn
          title="标签"
          values={data.tags}
          value={newTag}
          setValue={setNewTag}
          onSubmit={(e) => void create(e, "tag")}
          onRename={(item) => rename("tag", item)}
          onDelete={(item) => remove("tag", item)}
          busy={busy}
        />
      </div>
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
  onDelete,
  busy
}: {
  title: string;
  values: TaxonomyDetail[];
  value: string;
  setValue: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onRename: (item: TaxonomyDetail) => void;
  onDelete: (item: TaxonomyDetail) => void;
  busy: boolean;
}) {
  return (
    <section className="km-panel km-taxonomy-panel">
      <header><div><span className="km-eyebrow">MANAGE</span><h2>{title}</h2></div><strong>{values.length}</strong></header>
      <form className="km-taxonomy-create" onSubmit={onSubmit}>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={"新增" + title.slice(0, 2)} />
        <button className="dk-button dk-button-primary" disabled={busy || !value.trim()}>新增</button>
      </form>
      <div className="km-taxonomy-list">
        {values.map((item) => (
          <div key={item.id}>
            <span><strong>{item.name}</strong><small>{item.slug}</small></span>
            <b>{item.count}</b>
            <button onClick={() => onRename(item)}>重命名</button>
            <button onClick={() => onDelete(item)}>删除</button>
          </div>
        ))}
        {!values.length ? <p className="km-muted">暂无内容。</p> : null}
      </div>
    </section>
  );
}
