"use client";

import { FormEvent, useMemo, useState } from "react";
import type { TaxonomyDetail, TaxonomyKind } from "@/lib/blog/repository";

type TaxonomyState = {
  tags: TaxonomyDetail[];
  categories: TaxonomyDetail[];
};

function humanError(message: string) {
  const map: Record<string, string> = {
    taxonomy_name_required: "名称不能为空。",
    taxonomy_name_exists: "已经存在同名分类或标签。",
    taxonomy_not_found: "该项已经不存在，请刷新后重试。",
    invalid_id: "无效的分类或标签 ID。"
  };
  return map[message] ?? message;
}

export function TaxonomyManager({ initial }: { initial: TaxonomyState }) {
  const [state, setState] = useState(initial);
  const [kind, setKind] = useState<TaxonomyKind>("category");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const current = kind === "tag" ? state.tags : state.categories;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return current;
    return current.filter((item) =>
      item.name.toLocaleLowerCase().includes(needle) ||
      item.slug.toLocaleLowerCase().includes(needle)
    );
  }, [current, query]);

  async function action(actionName: "create" | "rename" | "delete", item?: TaxonomyDetail, nextName?: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/taxonomy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: actionName,
          kind,
          ...(item ? { id: item.id } : {}),
          ...(nextName !== undefined ? { name: nextName } : {})
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "操作失败");
      setState({ tags: payload.tags ?? [], categories: payload.categories ?? [] });
      setMessage(actionName === "create" ? "已创建" : actionName === "rename" ? "已重命名" : "已删除");
      return true;
    } catch (error) {
      setMessage(humanError(error instanceof Error ? error.message : "操作失败"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    if (await action("create", undefined, value)) setName("");
  }

  async function rename(item: TaxonomyDetail) {
    const value = window.prompt("新的名称", item.name)?.trim();
    if (!value || value === item.name) return;
    await action("rename", item, value);
  }

  async function remove(item: TaxonomyDetail) {
    const relation = item.count ? "目前有 " + item.count + " 篇文章使用它。" : "目前没有文章使用它。";
    if (!window.confirm("删除“" + item.name + "”？" + relation + " 删除后文章本身不会被删除。")) return;
    await action("delete", item);
  }

  return (
    <div className="taxonomy-layout">
      <section className="admin-panel taxonomy-toolbar">
        <div className="taxonomy-tabs" role="tablist" aria-label="分类与标签">
          <button type="button" className={kind === "category" ? "is-active" : ""} onClick={() => { setKind("category"); setQuery(""); }}>
            分类 <span>{state.categories.length}</span>
          </button>
          <button type="button" className={kind === "tag" ? "is-active" : ""} onClick={() => { setKind("tag"); setQuery(""); }}>
            标签 <span>{state.tags.length}</span>
          </button>
        </div>

        <form className="taxonomy-create" onSubmit={submit}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={kind === "tag" ? "新标签名称" : "新分类名称"}
            maxLength={100}
          />
          <button className="primary-button" type="submit" disabled={busy || !name.trim()}>新增</button>
        </form>

        <input
          className="taxonomy-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={"搜索" + (kind === "tag" ? "标签" : "分类") + "…"}
        />
      </section>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel taxonomy-list">
        <div className="taxonomy-head">
          <span>名称</span>
          <span>Slug</span>
          <span>文章数</span>
          <span>操作</span>
        </div>

        {filtered.map((item) => (
          <div className="taxonomy-row" key={item.id}>
            <strong>{item.name}</strong>
            <code>{item.slug}</code>
            <span>{item.count}</span>
            <div>
              <button type="button" disabled={busy} onClick={() => void rename(item)}>重命名</button>
              <button type="button" disabled={busy} className="danger-text" onClick={() => void remove(item)}>删除</button>
            </div>
          </div>
        ))}

        {filtered.length === 0 ? (
          <div className="admin-empty">
            {query ? "没有匹配项。" : kind === "tag" ? "还没有标签。" : "还没有分类。"}
          </div>
        ) : null}
      </section>
    </div>
  );
}
