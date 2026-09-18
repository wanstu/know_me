import { notFound } from "next/navigation";
import { PostEditor } from "@/components/admin/post-editor";
import { getPostById } from "@/lib/blog/repository";

export const runtime = "nodejs";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const post = getPostById(id);
  if (!post) notFound();

  return (
    <main className="admin-page">
      <PostEditor initialPost={post} />
    </main>
  );
}
