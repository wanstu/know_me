import { PostEditor } from "@/components/admin/post-editor";
import { getSiteSettings } from "@/lib/settings/repository";
import { themeClass } from "@/lib/settings/theme";

export default function NewPostPage() {
  const settings = getSiteSettings();
  return (
    <main className={"admin-page " + themeClass(settings)}>
      <PostEditor initialPost={null} />
    </main>
  );
}
