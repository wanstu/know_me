import { AdminShell } from "@/components/admin/admin-shell";
import { SettingsManager } from "@/components/admin/settings-manager";
import { getSiteSettings } from "@/lib/settings/repository";
import { listMedia } from "@/lib/media/repository";

export const runtime = "nodejs";

export default function AdminAppearancePage() {
  return (
    <AdminShell active="appearance">
      <div className="admin-heading">
        <div>
          <div className="eyebrow">Appearance</div>
          <h1>外观</h1>
          <p className="muted">选择主题、明暗模式、背景以及起始页视觉参数。</p>
        </div>
      </div>
      <SettingsManager initialSettings={getSiteSettings()} media={listMedia(120)} section="appearance" />
    </AdminShell>
  );
}
