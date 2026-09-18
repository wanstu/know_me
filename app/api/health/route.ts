import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    db.prepare("SELECT 1 AS ok").get();
    const migration = db.prepare(
      "SELECT id, applied_at AS appliedAt FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"
    ).get() as { id: string; appliedAt: number } | undefined;

    return NextResponse.json(
      {
        status: "ok",
        database: "ok",
        migration: migration?.id ?? null,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString()
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      {
        status: "error",
        database: "error",
        timestamp: new Date().toISOString()
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
