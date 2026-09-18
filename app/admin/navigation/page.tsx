import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { NavigationManager } from "@/components/admin/navigation-manager";
import { getNavigationTree } from "@/lib/navigation/repository";

export const runtime = "nodejs";

export default function NavigationAdminPage() {
  const tree = getNavigationTree(true);
  return (
    <AdminShell active="navigation">
      <div className="admin-heading">
        <div>
          <div className="eyebrow">Navigation</div>
          <h1>起始页管理</h1>
        </div>
        <Link className="primary-button" href="/start">查看起始页</Link>
      </div>
      <NavigationManager initialTree={tree} />
    </AdminShell>
  );
}
