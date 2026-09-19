import type { SessionUser, SiteSettings } from "./types";

export async function requestJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`);
  }
  return payload as T;
}

export async function getSiteSettings() {
  const payload = await requestJSON<{ settings: SiteSettings }>("/api/site");
  return payload.settings;
}

export async function getSession(): Promise<SessionUser | null> {
  const response = await fetch("/api/auth/me", { credentials: "same-origin", headers: { accept: "application/json" } });
  if (response.status === 401) return null;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || "auth_failed");
  return payload.user as SessionUser;
}

export async function login(username: string, password: string) {
  return requestJSON<{ ok: true; user: SessionUser; expiresAt: number }>("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
}

export async function logout() {
  return requestJSON<{ ok: true }>("/api/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
}
