import { randomBytes } from "node:crypto";
import { getDb } from "../lib/db";
import { hashPassword } from "../lib/auth/password";

const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const username = "__auth_smoke__";
const password = randomBytes(24).toString("base64url");
const db = getDb();

async function main() {
  const now = Date.now();
  const passwordHash = await hashPassword(password);
  db.prepare("DELETE FROM users WHERE username = ?").run(username);
  db.prepare("INSERT INTO users (username, password_hash, display_name, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(username, passwordHash, "Auth Smoke", "", now, now);

  try {
    const protectedResponse = await fetch(`${base}/start`, { redirect: "manual" });
    if (![302, 303, 307, 308].includes(protectedResponse.status)) {
      throw new Error(`protected route expected redirect, got ${protectedResponse.status}`);
    }

    const body = new URLSearchParams({ username, password, next: "/start" });
    const loginResponse = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: base },
      body,
      redirect: "manual"
    });
    if (loginResponse.status !== 303) throw new Error(`login expected 303, got ${loginResponse.status}`);

    const setCookie = loginResponse.headers.get("set-cookie");
    if (!setCookie) throw new Error("login did not set a session cookie");
    const cookie = setCookie.split(";")[0];

    const authedResponse = await fetch(`${base}/start`, { headers: { cookie }, redirect: "manual" });
    if (authedResponse.status !== 200) throw new Error(`authenticated /start expected 200, got ${authedResponse.status}`);
    const startHtml = await authedResponse.text();
    const firstGroup = db.prepare("SELECT name FROM nav_groups ORDER BY sort_order, id LIMIT 1").get() as { name: string } | undefined;
    if (firstGroup && !startHtml.includes(firstGroup.name)) throw new Error("authenticated /start did not render navigation data");

    const adminResponse = await fetch(`${base}/admin`, { headers: { cookie }, redirect: "manual" });
    if (adminResponse.status !== 200) throw new Error(`authenticated /admin expected 200, got ${adminResponse.status}`);

    const dedicatedAdminRoutes = ["/admin/navigation", "/admin/profile", "/admin/appearance", "/admin/import-export", "/admin/settings"];
    for (const route of dedicatedAdminRoutes) {
      const response = await fetch(`${base}${route}`, { headers: { cookie }, redirect: "manual" });
      if (response.status !== 200) throw new Error(`authenticated ${route} expected 200, got ${response.status}`);
    }

    const logoutResponse = await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: { cookie, origin: base },
      redirect: "manual"
    });
    if (logoutResponse.status !== 303) throw new Error(`logout expected 303, got ${logoutResponse.status}`);

    console.log("auth smoke: PASS");
    console.log(`protected=${protectedResponse.status} login=${loginResponse.status} start=${authedResponse.status} admin=${adminResponse.status} dedicated-admin=200 logout=${logoutResponse.status}`);
  } finally {
    const row = db.prepare("SELECT id FROM users WHERE username = ? LIMIT 1").get(username) as { id: number } | undefined;
    if (row) {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
      db.prepare("DELETE FROM users WHERE id = ?").run(row.id);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
