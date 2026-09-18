import { PostEditor } from "@/components/admin/post-editor";

export default function NewPostPage() {
  return (
    <main className="admin-page">
      <PostEditor initialPost={null} />
    </main>
  );
}
