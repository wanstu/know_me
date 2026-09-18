import Link from "next/link";

const demoMarkdown = [
  "# Markdown 写作系统应该保留哪些能力",
  "",
  "个人博客真正需要长期保存的是 **Markdown 源文档**，而不是某一套渲染后的 HTML。",
  "",
  "## 编辑体验",
  "",
  "- 自动保存",
  "- 粘贴图片直接上传",
  "- 代码块高亮",
  "- 表格、脚注、任务列表",
  "- Mermaid 与数学公式",
  "",
  "## 发布",
  "",
  "发布之前需要看到最终预览，同时保留每次重要修改的 revision。"
].join("\n");

export default function NewPostPage() {
  return (
    <main className="admin-page">
      <section className="editor-shell">
        <div className="editor-top">
          <Link href="/admin" className="chip">←</Link>
          <input className="editor-title" defaultValue="Markdown 写作系统应该保留哪些能力" aria-label="文章标题" />
          <div className="editor-actions">
            <button type="button">保存草稿</button>
            <button type="button">设置</button>
            <button className="publish" type="button">发布</button>
          </div>
        </div>

        <div className="editor-grid">
          <section className="editor-pane">
            <textarea defaultValue={demoMarkdown} aria-label="Markdown 编辑器" />
          </section>
          <section className="preview-pane">
            <div className="eyebrow" style={{ color: "#778395" }}>Preview</div>
            <h1>Markdown 写作系统应该保留哪些能力</h1>
            <p>个人博客真正需要长期保存的是 <strong>Markdown 源文档</strong>，而不是某一套渲染后的 HTML。</p>
            <h2>编辑体验</h2>
            <ul>
              <li>自动保存</li>
              <li>粘贴图片直接上传</li>
              <li>代码块高亮</li>
              <li>表格、脚注、任务列表</li>
              <li>Mermaid 与数学公式</li>
            </ul>
            <h2>发布</h2>
            <p>发布之前需要看到最终预览，同时保留每次重要修改的 revision。</p>
            <p className="prototype-note">Phase 3.5 会替换为真实 Markdown 渲染、自动保存和 revision。</p>
          </section>
        </div>
      </section>
    </main>
  );
}
