const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

type Entry = {
  count: number;
  firstAt: number;
  blockedUntil: number;
};

const globalStore = globalThis as typeof globalThis & {
  __knowMeLoginFailures?: Map<string, Entry>;
};

const store = globalStore.__knowMeLoginFailures ?? new Map<string, Entry>();
globalStore.__knowMeLoginFailures = store;

function clientKey(request: Request, username: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  const ip = forwarded || real || "unknown";
  return ip + "|" + username.trim().toLocaleLowerCase();
}

function cleanup(now: number) {
  if (store.size < 1000) return;
  for (const [key, entry] of store) {
    if (entry.blockedUntil <= now && now - entry.firstAt > WINDOW_MS) store.delete(key);
  }
}

export function checkLoginRateLimit(request: Request, username: string) {
  const now = Date.now();
  cleanup(now);
  const key = clientKey(request, username);
  const entry = store.get(key);
  if (!entry) return { allowed: true, retryAfterSeconds: 0 };

  if (entry.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000))
    };
  }

  if (now - entry.firstAt > WINDOW_MS) {
    store.delete(key);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordLoginFailure(request: Request, username: string) {
  const now = Date.now();
  const key = clientKey(request, username);
  const current = store.get(key);

  if (!current || now - current.firstAt > WINDOW_MS) {
    store.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
    return;
  }

  const count = current.count + 1;
  store.set(key, {
    count,
    firstAt: current.firstAt,
    blockedUntil: count >= MAX_FAILURES ? now + WINDOW_MS : 0
  });
}

export function clearLoginFailures(request: Request, username: string) {
  store.delete(clientKey(request, username));
}
