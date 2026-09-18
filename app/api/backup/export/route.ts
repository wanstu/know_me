import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createBackupZip } from "@/lib/backup";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const bytes = await createBackupZip();
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-") + "_" + String(now.getHours()).padStart(2, "0") + "-" + String(now.getMinutes()).padStart(2, "0");

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": "attachment; filename=know_me-backup-" + stamp + ".zip",
      "cache-control": "no-store"
    }
  });
}
