import { createBackupZip, restoreBackupZip } from "../lib/backup";
import { createGroup, createItem, getNavigationTree } from "../lib/navigation/repository";
import { deletePost, listPublishedPosts, savePost } from "../lib/blog/repository";
import { getSiteSettings, updateSiteSettings } from "../lib/settings/repository";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const original = await createBackupZip();

  try {
    const marker = "backup-smoke-" + Date.now();
    const groupId = createGroup({ name: marker, icon: "B" });
    createItem({ groupId, name: "Backup Smoke", url: "https://example.com/" });
    const post = savePost({
      title: marker,
      slug: marker,
      contentMd: "# Backup\n\nbackup_unique_term",
      status: "published"
    });
    updateSiteSettings({ quote: marker });

    const testBackup = await createBackupZip();

    deletePost(post.id);
    updateSiteSettings({ quote: "mutated" });

    const result = await restoreBackupZip(testBackup);
    assert(result.posts >= 1, "backup restore did not report posts");
    assert(listPublishedPosts("backup_unique_term", 20).some((item) => item.slug === marker), "post was not restored");
    assert(getNavigationTree(true).groups.some((group) => group.name === marker), "navigation was not restored");
    assert(getSiteSettings().quote === marker, "settings were not restored");

    console.log("backup smoke: PASS");
  } finally {
    await restoreBackupZip(original);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
