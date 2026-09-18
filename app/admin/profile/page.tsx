import { AdminShell } from "@/components/admin/admin-shell";
import { SettingsManager } from "@/components/admin/settings-manager";
import { getSiteSettings } from "@/lib/settings/repository";
import { listMedia } from "@/lib/media/repository";

export const runtime = "nodejs";

export default function AdminProfilePage() {
  return (
    <AdminShell active="profile">
      <div className="admin-heading">
        <div>
          <div className="eyebrow">Personal Home</div>
          <h1>个人主页</h1>
          <p className="muted">管理个人资料、社交入口、主页卡片和项目展示。</p>
        </div>
      </div>
      <SettingsManager initialSettings={getSiteSettings()} media={listMedia(120)} section="profile" />
    </AdminShell>
  );
}
