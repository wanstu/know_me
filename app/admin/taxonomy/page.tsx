import { AdminShell } from "@/components/admin/admin-shell";
import { TaxonomyManager } from "@/components/admin/taxonomy-manager";
import { listTaxonomyDetails } from "@/lib/blog/repository";

export const runtime = "nodejs";

export default function AdminTaxonomyPage() {
  const initial = listTaxonomyDetails();

  return (
    <AdminShell active="taxonomy">
      <div className="admin-heading">
        <div>
          <div className="eyebrow">Writing</div>
          <h1>分类与标签</h1>
          <p className="muted">统一维护文章分类和标签。重命名会保留文章关联，删除会移除对应关联。</p>
        </div>
      </div>
      <TaxonomyManager initial={initial} />
    </AdminShell>
  );
}
