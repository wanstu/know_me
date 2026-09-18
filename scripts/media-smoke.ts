import fs from "node:fs";
import { deleteMedia, mediaFilePath, saveMedia } from "../lib/media/repository";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl14KQAAAAASUVORK5CYII=",
  "base64"
);
const file = new File([png], "smoke.png", { type: "image/png" });
const media = saveMedia(file, png, "smoke");
try {
  if (!fs.existsSync(mediaFilePath(media.storageKey))) throw new Error("media file missing");
  if (!media.url.startsWith("/media/")) throw new Error("media URL invalid");
  console.log("media smoke: PASS");
} finally {
  deleteMedia(media.id);
}
