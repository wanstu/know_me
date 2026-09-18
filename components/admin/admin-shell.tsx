import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";

const menu = [
  { key: "dashboard", label: "总览", href: "/admin" },
  { key: "posts", label: "文章", href: "/admin/posts" },
  { key: "taxonomy", label: "分类与标签", href: "/admin/taxonomy" },
  { key: "media", label: "媒体", href: "/admin/media" },
  { key: "navigation", label: "起始页", href: "/admin/navigation" },
  { key: "profile", label: "个人主页", href: "/admin/settings" },
  { key: "appearance", label: "外观", href: "/admin/settings" },
  { key: "import", label: "导入 / 导出", href: "/admin/navigation#import" },
  { key: "settings", label: "设置", href: "/admin/settings" }
];

export function AdminShell({
  active,
  children
}: {
  active: string;
  children: React.ReactNode;
}) {
  return (
    <main className="admin-page">
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <Link href="/" className="admin-logo">know_me</Link>
          {menu.map((item) => (
            <Link href={item.href} key={item.key} className={item.key === active ? "is-active" : ""}>
              {item.label}
            </Link>
          ))}
          <LogoutButton />
        </aside>
        <section className="admin-main">{children}</section>
      </div>
    </main>
  );
}
