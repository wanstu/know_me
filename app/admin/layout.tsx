import { requireUser } from "@/lib/auth/session";

export const runtime = "nodejs";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireUser("/admin");
  return children;
}
