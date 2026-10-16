import { useEffect, useState } from "react";
import { requestJSON } from "../../api";

type AuditToken = { id: string; name: string };
type AuditEvent = {
  id: number; occurredAt: number; eventType: string;
  tokenId?: string; tokenName?: string; tokenScope?: string;
  toolName?: string; requiredPermission?: string; targetType?: string;
  targetId?: string; action?: string; result: string; reason?: string;
  httpMethod?: string; remotePeer?: string;
};
const reasons: Record<string,string> = {
  authorization_missing:"没有携带 Authorization",
  authorization_invalid_scheme:"Authorization 格式错误，应使用 Bearer",
  token_invalid_or_revoked:"Token 无效或已吊销",
  origin_mismatch:"Origin 与站点地址不一致",
  token_accepted:"Token 验证通过",
  permission_denied:"没有相应操作权限",
  confirmation_required:"操作缺少明确确认",
  conflict:"文章已发生变更",
  validation_failed:"参数校验失败",
  not_found:"对象不存在",
  operation_failed:"工具执行失败"
};
function label(value:string){
  return value==="success"?"成功":value==="denied"?"拒绝":value==="error"?"失败":value;
}
export function MCPAuditPanel({tokens}:{tokens:AuditToken[]}) {
  const [items,setItems]=useState<AuditEvent[]>([]);
  const [result,setResult]=useState("");
  const [tokenId,setTokenId]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [more,setMore]=useState(false);
  async function load(append=false){
    setLoading(true);setError("");
    try {
      const params=new URLSearchParams({limit:"50"});
      if(result)params.set("result",result);
      if(tokenId)params.set("tokenId",tokenId);
      if(append && items.length)params.set("beforeId",String(items[items.length-1].id));
      const response=await requestJSON<{events:AuditEvent[]}>("/api/mcp/audit?"+params);
      const next=response.events??[];
      setItems(append?[...items,...next]:next);
      setMore(next.length===50);
      setLoaded(true);
    }catch(err){setError(err instanceof Error?err.message:"日志查询失败");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[result,tokenId]);
  return <section className="km-panel km-admin-form km-mcp-panel">
    <h2>MCP 操作与鉴权日志</h2>
    <p className="km-muted">记录请求认证、调用的工具、文章 ID、结果和失败原因。不会保存 Token 明文、工具参数、文章正文或返回内容；日志定期清理（约 30 天或最近 20,000 条）。</p>
    <div className="km-mcp-audit-filters">
      <label className="dk-field">Token
        <select value={tokenId} onChange={e=>setTokenId(e.target.value)}>
          <option value="">全部（含未认证请求）</option>
          {tokens.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="dk-field">结果
        <select value={result} onChange={e=>setResult(e.target.value)}>
          <option value="">全部</option><option value="success">成功</option><option value="denied">拒绝</option><option value="error">失败</option>
        </select>
      </label>
      <button type="button" className="dk-button" disabled={loading} onClick={()=>void load()}>刷新日志</button>
    </div>
    {error?<p role="alert" className="km-entry-link-error">{error}</p>:null}
    {!loaded?<p className="km-muted">加载中…</p>:items.length===0?<p className="km-muted">暂无符合条件的日志。</p>:
      <div className="km-mcp-audit-scroll">
        <table className="km-mcp-audit-table">
          <thead><tr><th>时间</th><th>Token / 来源</th><th>操作</th><th>目标</th><th>结果与原因</th></tr></thead>
          <tbody>{items.map(item=><tr key={item.id}>
            <td>{new Date(item.occurredAt).toLocaleString("zh-CN")}</td>
            <td>{item.tokenName||"未认证"}<small>{item.remotePeer||""}</small></td>
            <td><code>{item.toolName||(item.eventType==="token_management"?"Token "+(item.action||"管理"):item.eventType==="protocol_http"?"MCP 协议 "+(item.httpMethod||""):"认证 "+(item.httpMethod||""))}</code>
              {item.requiredPermission?<small>{item.requiredPermission}</small>:null}</td>
            <td>{item.targetId?item.targetType+" #"+item.targetId:"—"}{item.action?<small>{item.action}</small>:null}</td>
            <td><strong>{label(item.result)}</strong><small>{reasons[item.reason||""]||item.reason||"—"}</small></td>
          </tr>)}</tbody>
        </table>
      </div>}
    {more?<button type="button" className="dk-button" disabled={loading} onClick={()=>void load(true)}>加载更早记录</button>:null}
  </section>;
}
