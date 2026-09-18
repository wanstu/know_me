import Link from "next/link";

const menu = ["总览", "文章", "分类与标签", "媒体", "起始页", "个人主页", "外观", "导入 / 导出", "设置"];

export default function AdminPage() {
  return (
    <main className="admin-page">
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div className="admin-logo">know_me</div>
          {menu.map((item, index) => (
            <a href="#" key={item} className={index === 0 ? "is-active" : ""}>{item}</a>
          ))}
        </aside>

        <section className="admin-main">
          <div className="admin-heading">
            <div>
              <div className="eyebrow">Dashboard</div>
              <h1>晚上好</h1>
            </div>
            <Link className="primary-button" href="/admin/posts/new">＋ 写文章</Link>
          </div>

          <div className="stats-grid">
            <div className="stat-card"><span className="muted">已发布文章</span><strong>3</strong></div>
            <div className="stat-card"><span className="muted">草稿</span><strong>0</strong></div>
            <div className="stat-card"><span className="muted">导航入口</span><strong>101</strong></div>
            <div className="stat-card"><span className="muted">媒体</span><strong>0</strong></div>
          </div>

          <div className="admin-grid">
            <div className="admin-panel">
              <strong>最近文章</strong>
              <div className="admin-row"><span>把三个入口做成一个产品</span><span className="status-published">已发布</span><span>09-18</span></div>
              <div className="admin-row"><span>Markdown 写作系统</span><span>草稿</span><span>09-18</span></div>
              <div className="admin-row"><span>主页不是简历</span><span className="status-published">已发布</span><span>09-03</span></div>
            </div>

            <div className="admin-panel">
              <strong>快捷操作</strong>
              <Link className="quick-link" href="/start">查看起始页</Link>
              <a className="quick-link" href="#">导入 iTab 数据</a>
              <a className="quick-link" href="#">更换主页背景</a>
              <a className="quick-link" href="#">创建备份</a>
              <p className="prototype-note">认证会在 Phase 3.2 接入；当前后台仅为实现骨架。</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
