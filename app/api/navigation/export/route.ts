import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { exportItab } from "@/lib/navigation/itab";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getSessionUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}_${String(now.getMinutes()).padStart(2, "0")}`;
  return new NextResponse(exportItab(), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`iTab备份-${stamp}.itabdata`)}`
    }
  });
}
