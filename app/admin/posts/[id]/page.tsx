import { notFound } from "next/navigation";
import { PostEditor } from "@/components/admin/post-editor";
import { getPostById } from "@/lib/blog/repository";
import { getSiteSettings } from "@/lib/settings/repository";
import { themeClass } from "@/lib/settings/theme";

export const runtime = "nodejs";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const post = getPostById(id);
  if (!post) notFound();
  const settings = getSiteSettings();

  return (
    <main className={"admin-page " + themeClass(settings)}>
      <PostEditor initialPost={post} />
    </main>
  );
}
