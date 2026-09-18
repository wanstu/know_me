import fs from "node:fs";
import { NextResponse } from "next/server";
import { getMediaByStorageKey, mediaFilePath } from "@/lib/media/repository";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.map(decodeURIComponent).join("/");
  const media = getMediaByStorageKey(key);
  if (!media) return new NextResponse("Not found", { status: 404 });

  try {
    const bytes = fs.readFileSync(mediaFilePath(media.storageKey));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": media.mime,
        "content-length": String(bytes.length),
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
