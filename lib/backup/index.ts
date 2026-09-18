import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { getDb } from "@/lib/db";
import { markdownToText } from "@/lib/blog/repository";

const BACKUP_FORMAT = "know_me_backup";
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

const contentTables = [
  "media",
  "posts",
  "post_revisions",
  "categories",
  "tags",
  "post_categories",
  "post_tags",
  "nav_groups",
  "nav_items",
  "settings"
] as const;

type TableName = (typeof contentTables)[number];
type Row = Record<string, string | number | null>;

type BackupPayload = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  tables: Record<TableName, Row[]>;
};

function uploadsRoot() {
  return path.join(process.cwd(), "uploads");
}

function collectFiles(root: string, current = root): Array<{ relative: string; full: string }> {
  if (!fs.existsSync(current)) return [];
  const out: Array<{ relative: string; full: string }> = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(root, full));
    else if (entry.isFile()) out.push({ relative: path.relative(root, full).replace(/\\/g, "/"), full });
  }
  return out;
}

function safeRelative(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) throw new Error("invalid_backup_path");
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "")) throw new Error("invalid_backup_path");
  return normalized;
}

export async function createBackupZip() {
  const db = getDb();
  const tables = {} as BackupPayload["tables"];
  for (const table of contentTables) {
    tables[table] = db.prepare("SELECT * FROM " + table).all() as Row[];
  }

  const payload: BackupPayload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tables
  };

  const zip = new JSZip();
  zip.file("backup.json", JSON.stringify(payload, null, 2));
  zip.file(
    "README.txt",
    [
      "know_me backup",
      "",
      "This archive contains site content, settings, navigation, blog data and media.",
      "Administrator credentials and active sessions are intentionally NOT included.",
      "Exported: " + payload.exportedAt
    ].join("\n")
  );

  for (const file of collectFiles(uploadsRoot())) {
    zip.file("uploads/" + file.relative, fs.readFileSync(file.full));
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

function parsePayload(raw: string): BackupPayload {
  const value = JSON.parse(raw) as Partial<BackupPayload>;
  if (value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION || !value.tables) {
    throw new Error("unsupported_backup");
  }
  for (const table of contentTables) {
    if (!Array.isArray(value.tables[table])) throw new Error("backup_table_missing_" + table);
  }
  return value as BackupPayload;
}

function insertRows(table: TableName, rows: Row[]) {
  if (!rows.length) return;
  const db = getDb();
  for (const row of rows) {
    const columns = Object.keys(row);
    if (!columns.length) continue;
    const quoted = columns.map((column) => '"' + column.replace(/"/g, '""') + '"').join(",");
    const placeholders = columns.map(() => "?").join(",");
    db.prepare("INSERT INTO " + table + " (" + quoted + ") VALUES (" + placeholders + ")").run(
      ...columns.map((column) => row[column])
    );
  }
}

function rebuildFts() {
  const db = getDb();
  db.prepare("DELETE FROM posts_fts").run();
  const rows = db.prepare(
    "SELECT id, title, excerpt, content_md AS contentMd FROM posts"
  ).all() as Array<{ id: number; title: string; excerpt: string; contentMd: string }>;
  const insert = db.prepare(
    "INSERT INTO posts_fts (rowid, title, excerpt, content_text) VALUES (?, ?, ?, ?)"
  );
  for (const row of rows) insert.run(row.id, row.title, row.excerpt, markdownToText(row.contentMd));
}

function replaceDatabaseContent(payload: BackupPayload) {
  const db = getDb();
  db.transaction(() => {
    db.pragma("defer_foreign_keys = ON");
    db.prepare("DELETE FROM post_tags").run();
    db.prepare("DELETE FROM post_categories").run();
    db.prepare("DELETE FROM post_revisions").run();
    db.prepare("DELETE FROM posts_fts").run();
    db.prepare("DELETE FROM posts").run();
    db.prepare("DELETE FROM tags").run();
    db.prepare("DELETE FROM categories").run();
    db.prepare("DELETE FROM nav_items").run();
    db.prepare("DELETE FROM nav_groups").run();
    db.prepare("DELETE FROM media").run();
    db.prepare("DELETE FROM settings").run();

    insertRows("media", payload.tables.media);
    insertRows("posts", payload.tables.posts);
    insertRows("post_revisions", payload.tables.post_revisions);
    insertRows("categories", payload.tables.categories);
    insertRows("tags", payload.tables.tags);
    insertRows("post_categories", payload.tables.post_categories);
    insertRows("post_tags", payload.tables.post_tags);
    insertRows("nav_groups", payload.tables.nav_groups);
    insertRows("nav_items", payload.tables.nav_items);
    insertRows("settings", payload.tables.settings);
    rebuildFts();
  })();
}

function removeTree(target: string) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

export async function restoreBackupZip(bytes: Uint8Array) {
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_BACKUP_BYTES) throw new Error("backup_size_invalid");

  const zip = await JSZip.loadAsync(bytes);
  const payloadFile = zip.file("backup.json");
  if (!payloadFile) throw new Error("backup_manifest_missing");
  const payload = parsePayload(await payloadFile.async("string"));

  const root = uploadsRoot();
  const parent = path.dirname(root);
  const tempRoot = path.join(parent, ".uploads-restore-" + randomUUID());
  const oldRoot = path.join(parent, ".uploads-before-restore-" + randomUUID());
  fs.mkdirSync(tempRoot, { recursive: true });

  try {
    const uploadEntries = Object.values(zip.files).filter(
      (entry) => !entry.dir && entry.name.startsWith("uploads/")
    );
    for (const entry of uploadEntries) {
      const relative = safeRelative(entry.name.slice("uploads/".length));
      const full = path.join(tempRoot, ...relative.split("/"));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, await entry.async("nodebuffer"));
    }

    let oldMoved = false;
    try {
      if (fs.existsSync(root)) {
        fs.renameSync(root, oldRoot);
        oldMoved = true;
      }
      fs.renameSync(tempRoot, root);

      try {
        replaceDatabaseContent(payload);
      } catch (error) {
        removeTree(root);
        if (oldMoved && fs.existsSync(oldRoot)) fs.renameSync(oldRoot, root);
        throw error;
      }

      if (oldMoved) removeTree(oldRoot);
    } catch (error) {
      if (fs.existsSync(tempRoot)) removeTree(tempRoot);
      throw error;
    }
  } finally {
    if (fs.existsSync(tempRoot)) removeTree(tempRoot);
  }

  return {
    exportedAt: payload.exportedAt,
    posts: payload.tables.posts.length,
    navigationItems: payload.tables.nav_items.length,
    media: payload.tables.media.length
  };
}
