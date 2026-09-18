import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";

const allowedTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

export type MediaRecord = {
  id: number;
  storageKey: string;
  originalName: string;
  mime: string;
  size: number;
  alt: string;
  createdAt: number;
  url: string;
};

function publicUrl(storageKey: string) {
  return "/media/" + storageKey.split("/").map(encodeURIComponent).join("/");
}

function mapRow(row: {
  id: number;
  storageKey: string;
  originalName: string;
  mime: string;
  size: number;
  alt: string;
  createdAt: number;
}): MediaRecord {
  return { ...row, url: publicUrl(row.storageKey) };
}

export function saveMedia(file: File, bytes: Uint8Array, alt = "") {
  const ext = allowedTypes[file.type];
  if (!ext) throw new Error("unsupported_media_type");
  if (bytes.byteLength <= 0 || bytes.byteLength > 10 * 1024 * 1024) throw new Error("media_size_invalid");

  const now = new Date();
  const storageKey = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    randomUUID() + "." + ext
  ].join("/");

  const root = path.join(process.cwd(), "uploads");
  const fullPath = path.join(root, ...storageKey.split("/"));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, bytes);

  const createdAt = Date.now();
  const result = getDb().prepare(
    "INSERT INTO media (storage_key, original_name, mime, width, height, size, alt, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)"
  ).run(storageKey, file.name.slice(0, 240), file.type, bytes.byteLength, alt.slice(0, 500), createdAt);

  return getMediaById(Number(result.lastInsertRowid))!;
}

export function listMedia(limit = 200) {
  const rows = getDb().prepare(
    "SELECT id, storage_key AS storageKey, original_name AS originalName, mime, size, alt, created_at AS createdAt FROM media ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as Array<{
    id: number; storageKey: string; originalName: string; mime: string; size: number; alt: string; createdAt: number;
  }>;
  return rows.map(mapRow);
}

export function getMediaById(id: number) {
  const row = getDb().prepare(
    "SELECT id, storage_key AS storageKey, original_name AS originalName, mime, size, alt, created_at AS createdAt FROM media WHERE id = ? LIMIT 1"
  ).get(id) as {
    id: number; storageKey: string; originalName: string; mime: string; size: number; alt: string; createdAt: number;
  } | undefined;
  return row ? mapRow(row) : null;
}

export function getMediaByStorageKey(storageKey: string) {
  const row = getDb().prepare(
    "SELECT id, storage_key AS storageKey, original_name AS originalName, mime, size, alt, created_at AS createdAt FROM media WHERE storage_key = ? LIMIT 1"
  ).get(storageKey) as {
    id: number; storageKey: string; originalName: string; mime: string; size: number; alt: string; createdAt: number;
  } | undefined;
  return row ? mapRow(row) : null;
}

export function mediaFilePath(storageKey: string) {
  const root = path.resolve(process.cwd(), "uploads");
  const fullPath = path.resolve(root, ...storageKey.split("/"));
  if (!fullPath.startsWith(root + path.sep)) throw new Error("invalid_storage_key");
  return fullPath;
}

export function deleteMedia(id: number) {
  const media = getMediaById(id);
  if (!media) return false;
  getDb().prepare("DELETE FROM media WHERE id = ?").run(id);
  const filePath = mediaFilePath(media.storageKey);
  try { fs.unlinkSync(filePath); } catch {}
  return true;
}
