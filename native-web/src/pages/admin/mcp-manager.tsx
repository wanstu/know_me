import { useEffect, useState } from "react";
import { requestJSON } from "../../api";
import { AdminTitle } from "../../ui";
import { MCPAuditPanel } from "./mcp-audit";

type Token = { id: string; name: string; scope: "read" | "write"; createdAt: number; lastUsedAt: number | null };
type ListResponse = { endpoint: string; tokens: Token[] };

export function MCPManager() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
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
    setError("");
    setSecret("");
    setBusy(true);
    try {
      const result = await requestJSON<{ token: Token; secret: string }>("/api/mcp/tokens", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scope })
      });
      setSecret(result.secret);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally { setBusy(false); }
  }

  async function revoke(token: Token) {
    if (!window.confirm(`确认吊销“${token.name}”？所有使用该令牌的 AI 客户端会立即失去访问权限。`)) return;
    setError("");
    setBusy(true);
    try {
      await requestJSON("/api/mcp/tokens/" + encodeURIComponent(token.id), { method: "DELETE" });
      setSecret("");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "吊销失败"); }
    finally { setBusy(false); }
  }

  return (
    <>
      <AdminTitle eyebrow="MCP" title="AI 接入" description="向 ChatGPT、Claude 等 MCP 客户端开放 Know Me 的文章、分类、网站设置和起始页管理能力。" />
      <section className="km-panel km-admin-form km-mcp-panel">
        <h2>连接地址</h2>
        <div className="km-mcp-endpoint"><code>{endpoint}</code><button type="button" className="dk-button" onClick={() => void navigator.clipboard.writeText(endpoint)}>复制地址</button></div>
        <p className="km-muted">协议：Streamable HTTP；使用 Authorization: Bearer 令牌。默认没有访问令牌时，MCP 无法连接；浏览器登录状态不能代替令牌。</p>
      </section>
      <section className="km-panel km-admin-form km-mcp-panel">
        <h2>创建访问令牌</h2>
        <div className="km-mcp-create">
          <label className="dk-field">名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 ChatGPT / 个人助手" maxLength={100} /></label>
          <label className="dk-field">权限<select value={scope} onChange={(e) => setScope(e.target.value as "read" | "write")}>
            <option value="read">只读 · 查询内容和设置</option>
            <option value="write">读写 · 可编辑与删除内容</option>
          </select></label>
          <button type="button" className="dk-button dk-button-primary" disabled={busy} onClick={() => void createToken()}>创建令牌</button>
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
          <div className="km-mcp-list">{tokens.map((token) => (
            <div className="km-mcp-row" key={token.id}>
              <div><strong>{token.name}</strong><small>{token.scope === "read" ? "只读" : "读写"} · 创建于 {new Date(token.createdAt).toLocaleString("zh-CN")} · {token.lastUsedAt ? "最近使用 " + new Date(token.lastUsedAt).toLocaleString("zh-CN") : "尚未使用"}</small></div>
              <button type="button" className="dk-button" disabled={busy} onClick={() => void revoke(token)}>吊销</button>
            </div>
          ))}</div>
        )}
      </section>
      <MCPAuditPanel tokens={tokens} />
    </>
  );
}
