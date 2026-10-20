import { useEffect, useState } from "react";
import { requestJSON } from "../../api";
import { AdminTitle } from "../../ui";
import { MCPAuditPanel } from "./mcp-audit";

type Permission =
  | "posts.read" | "posts.write"
  | "taxonomy.read" | "taxonomy.write"
  | "site.read" | "site.write"
  | "start.read" | "start.write"
  | "navigation.read" | "navigation.write"
  | "media.write";

type Token = {
  id: string;
  name: string;
  scope: "read" | "write";
  permissions?: Permission[];
  permissionMode?: "legacy" | "custom";
  createdAt: number;
  lastUsedAt: number | null;
};

type ListResponse = { endpoint: string; tokens: Token[]; permissions?: Permission[] };

type PermissionGroup = {
  key: string;
  label: string;
  description: string;
  read?: Permission;
  write?: Permission;
};

const permissionGroups: PermissionGroup[] = [
  { key: "posts", label: "文章", description: "文章、修订、导入预览与文章批量操作", read: "posts.read", write: "posts.write" },
  { key: "taxonomy", label: "分类与标签", description: "分类、标签读取以及创建、改名、删除和合并", read: "taxonomy.read", write: "taxonomy.write" },
  { key: "site", label: "站点设置", description: "主页、主题、访问规则、友链和个人资料", read: "site.read", write: "site.write" },
  { key: "start", label: "Start 设置", description: "搜索引擎、背景、密度和滚动等 Start 配置", read: "start.read", write: "start.write" },
  { key: "navigation", label: "Start 导航", description: "导航分组、链接和文件夹", read: "navigation.read", write: "navigation.write" },
  { key: "media", label: "媒体", description: "向媒体库上传图片；当前没有独立媒体读取工具", write: "media.write" },
];

const permissionLabels: Record<Permission, string> = {
  "posts.read": "文章读取",
  "posts.write": "文章管理",
  "taxonomy.read": "分类标签读取",
  "taxonomy.write": "分类标签管理",
  "site.read": "站点读取",
  "site.write": "站点管理",
  "start.read": "Start 读取",
  "start.write": "Start 管理",
  "navigation.read": "导航读取",
  "navigation.write": "导航管理",
  "media.write": "媒体上传",
};

const allReadPermissions = permissionGroups.flatMap((group) => group.read ? [group.read] : []);
const allPermissions = permissionGroups.flatMap((group) => [group.read, group.write].filter(Boolean) as Permission[]);

function sortedPermissions(values: Iterable<Permission>) {
  return [...new Set(values)].sort() as Permission[];
}

function effectivePermissions(token: Token): Permission[] {
  if (token.permissionMode === "custom" && token.permissions?.length) {
    return sortedPermissions(token.permissions);
  }
  const values = [...allReadPermissions];
  if (token.scope === "write") values.push(...allPermissions.filter((permission) => permission.endsWith(".write")));
  return sortedPermissions(values);
}

function PermissionEditor({ value, onChange, compact = false }: {
  value: Permission[];
  onChange: (value: Permission[]) => void;
  compact?: boolean;
}) {
  const selected = new Set(value);

  function toggle(group: PermissionGroup, kind: "read" | "write", checked: boolean) {
    const permission = group[kind];
    if (!permission) return;
    const next = new Set(selected);
    if (checked) {
      next.add(permission);
      if (kind === "write" && group.read) next.add(group.read);
    } else {
      next.delete(permission);
      if (kind === "read" && group.write) next.delete(group.write);
    }
    onChange(sortedPermissions(next));
  }

  return (
    <div className={"km-mcp-permission-editor" + (compact ? " is-compact" : "")}>
      <div className="km-mcp-permission-presets">
        <span>快捷选择</span>
        <button type="button" className="dk-button" onClick={() => onChange(sortedPermissions(allReadPermissions))}>全部只读</button>
        <button type="button" className="dk-button" onClick={() => onChange(sortedPermissions(allPermissions))}>全部管理</button>
        <button type="button" className="dk-button" onClick={() => onChange([])}>清空</button>
      </div>
      <div className="km-mcp-permission-grid">
        {permissionGroups.map((group) => (
          <div className="km-mcp-permission-group" key={group.key}>
            <div>
              <strong>{group.label}</strong>
              <small>{group.description}</small>
            </div>
            <div className="km-mcp-permission-checks">
              {group.read ? (
                <label><input type="checkbox" checked={selected.has(group.read)} onChange={(event) => toggle(group, "read", event.target.checked)} />读取</label>
              ) : null}
              {group.write ? (
                <label><input type="checkbox" checked={selected.has(group.write)} onChange={(event) => toggle(group, "write", event.target.checked)} />{group.key === "media" ? "上传" : "管理"}</label>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <small className="km-muted">管理权限会自动包含同模块的读取权限。未勾选的模块不会出现在该 Token 的 MCP 工具列表中。</small>
    </div>
  );
}

export function MCPManager() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editingTokenId, setEditingTokenId] = useState("");
  const [editingPermissions, setEditingPermissions] = useState<Permission[]>([]);
  const endpoint = window.location.origin + "/mcp";

  async function load() {
    const result = await requestJSON<ListResponse>("/api/mcp/tokens");
    setTokens(result.tokens ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    void load().catch((err) => { setLoaded(true); setError(String(err)); });
  }, []);

  async function createToken() {
    if (!name.trim()) { setError("请输入令牌名称"); return; }
    if (permissions.length === 0) { setError("至少选择一项权限"); return; }
    setError("");
    setSecret("");
    setBusy(true);
    try {
      const result = await requestJSON<{ token: Token; secret: string }>("/api/mcp/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), permissions }),
      });
      setSecret(result.secret);
      setName("");
      setPermissions([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  function editPermissions(token: Token) {
    setEditingTokenId(token.id);
    setEditingPermissions(effectivePermissions(token));
    setError("");
  }

  async function savePermissions(token: Token) {
    if (editingPermissions.length === 0) { setError("至少保留一项权限；如果不再使用请直接吊销 Token"); return; }
    setBusy(true);
    setError("");
    try {
      await requestJSON("/api/mcp/tokens/" + encodeURIComponent(token.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: editingPermissions }),
      });
      setEditingTokenId("");
      setEditingPermissions([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "权限更新失败");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: Token) {
    if (!window.confirm(`确认吊销“${token.name}”？所有使用该令牌的 AI 客户端会立即失去访问权限。`)) return;
    setError("");
    setBusy(true);
    try {
      await requestJSON("/api/mcp/tokens/" + encodeURIComponent(token.id), { method: "DELETE" });
      setSecret("");
      if (editingTokenId === token.id) setEditingTokenId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "吊销失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminTitle eyebrow="MCP" title="AI 接入" description="按 Token 精确控制 ChatGPT、Claude 等 MCP 客户端能读取和修改 Know Me 的哪些模块。" />
      <section className="km-panel km-admin-form km-mcp-panel">
        <h2>连接地址</h2>
        <div className="km-mcp-endpoint"><code>{endpoint}</code><button type="button" className="dk-button" onClick={() => void navigator.clipboard.writeText(endpoint)}>复制地址</button></div>
        <p className="km-muted">协议：Streamable HTTP；使用 Authorization: Bearer 令牌。浏览器登录状态不能代替 Token。</p>
      </section>

      <section className="km-panel km-admin-form km-mcp-panel">
        <h2>创建访问令牌</h2>
        <div className="km-mcp-create">
          <label className="dk-field">名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 ChatGPT / 文章助手" maxLength={100} /></label>
        </div>
        <PermissionEditor value={permissions} onChange={setPermissions} />
        <div className="km-mcp-create-actions">
          <span className="km-muted">{permissions.length ? `已选择 ${permissions.length} 项权限` : "默认不授予任何权限，请明确勾选需要的能力"}</span>
          <button type="button" className="dk-button dk-button-primary" disabled={busy || permissions.length === 0} onClick={() => void createToken()}>创建令牌</button>
        </div>
        {secret ? (
          <div className="km-mcp-secret">
            <strong>令牌仅展示这一次，请复制到 MCP 客户端。</strong>
            <div className="km-mcp-endpoint"><code>{secret}</code><button type="button" className="dk-button" onClick={() => void navigator.clipboard.writeText(secret)}>复制令牌</button></div>
            <button type="button" className="dk-button" onClick={() => setSecret("")}>我已保存，隐藏令牌</button>
          </div>
        ) : null}
        {error ? <p role="alert" className="km-entry-link-error">{error}</p> : null}
      </section>

      <section className="km-panel km-admin-form km-mcp-panel">
        <h2>现有令牌</h2>
        {!loaded ? <p className="km-muted">加载中…</p> : tokens.length === 0 ? <p className="km-muted">尚未创建任何令牌。MCP 服务当前不允许外部访问。</p> : (
          <div className="km-mcp-list">{tokens.map((token) => {
            const effective = effectivePermissions(token);
            const editing = editingTokenId === token.id;
            return (
              <div className={"km-mcp-row" + (editing ? " is-editing" : "")} key={token.id}>
                <div className="km-mcp-token-main">
                  <div className="km-mcp-token-title">
                    <strong>{token.name}</strong>
                    <span className={"km-mcp-mode " + (token.permissionMode === "custom" ? "is-custom" : "is-legacy")}>
                      {token.permissionMode === "custom" ? "细粒度" : "兼容模式"}
                    </span>
                  </div>
                  <small>
                    创建于 {new Date(token.createdAt).toLocaleString("zh-CN")} · {token.lastUsedAt ? "最近使用 " + new Date(token.lastUsedAt).toLocaleString("zh-CN") : "尚未使用"}
                    {token.permissionMode !== "custom" ? ` · 原${token.scope === "read" ? "只读" : "读写"} Token，行为保持兼容` : ""}
                  </small>
                  {!editing ? (
                    <div className="km-mcp-permission-chips">
                      {effective.map((permission) => <span key={permission}>{permissionLabels[permission]}</span>)}
                    </div>
                  ) : null}
                </div>
                {!editing ? (
                  <div className="km-mcp-row-actions">
                    <button type="button" className="dk-button" disabled={busy} onClick={() => editPermissions(token)}>调整权限</button>
                    <button type="button" className="dk-button" disabled={busy} onClick={() => void revoke(token)}>吊销</button>
                  </div>
                ) : (
                  <div className="km-mcp-token-editor">
                    <PermissionEditor value={editingPermissions} onChange={setEditingPermissions} compact />
                    <div className="km-mcp-row-actions">
                      <button type="button" className="dk-button" disabled={busy} onClick={() => { setEditingTokenId(""); setEditingPermissions([]); }}>取消</button>
                      <button type="button" className="dk-button dk-button-primary" disabled={busy || editingPermissions.length === 0} onClick={() => void savePermissions(token)}>保存权限</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}</div>
        )}
      </section>
      <MCPAuditPanel tokens={tokens} />
    </>
  );
}
