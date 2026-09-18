import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { SettingsManager } from "@/components/admin/settings-manager";
import { getSiteSettings } from "@/lib/settings/repository";

export const runtime = "nodejs";

export default function SettingsPage() {
  return (
    <AdminShell active="settings">
      <div className="admin-heading">
        <div>
          <div className="eyebrow">Site Settings</div>
          <h1>站点设置</h1>
        </div>
        <div className="nav-admin-toolbar-actions">
          <Link className="secondary-button" href="/">查看主页</Link>
          <Link className="secondary-button" href="/start">查看起始页</Link>
        </div>
      </div>
      <SettingsManager initialSettings={getSiteSettings()} />
    </AdminShell>
  );
}
