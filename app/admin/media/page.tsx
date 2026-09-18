import { AdminShell } from "@/components/admin/admin-shell";
import { MediaManager } from "@/components/admin/media-manager";
import { listMedia } from "@/lib/media/repository";

export const runtime = "nodejs";

export default function MediaPage() {
  return (
    <AdminShell active="media">
      <div className="admin-heading">
        <div>
          <div className="eyebrow">Media</div>
          <h1>媒体库</h1>
        </div>
      </div>
      <MediaManager initialMedia={listMedia()} />
    </AdminShell>
  );
}
