import { AdminShell } from "@/components/admin/admin-shell";
import { NavigationImportExport } from "@/components/admin/navigation-import-export";

export const runtime = "nodejs";

export default function ImportExportPage() {
  return (
    <AdminShell active="import">
      <div className="admin-heading">
        <div>
          <div className="eyebrow">Data</div>
          <h1>导入 / 导出</h1>
          <p className="muted">管理 iTab 导航数据的导入与导出，不需要再到起始页管理底部查找。</p>
        </div>
      </div>
      <NavigationImportExport />
    </AdminShell>
  );
}
