import { getDb } from "@/lib/db";

export type SearchEngineName = "Bing" | "Google" | "DuckDuckGo";
export type ThemeMode = "auto" | "dark" | "light";

export type SiteSettings = {
  profileName: string;
  profileTagline: string;
  profileBio: string;
  avatarUrl: string;
  quote: string;
  quoteAuthor: string;
  githubUrl: string;
  emailUrl: string;
  aboutUrl: string;
  homeBackgroundUrl: string;
  startBackgroundUrl: string;
  startPublic: boolean;
  defaultSearchEngine: SearchEngineName;
  themeMode: ThemeMode;
};

const defaults: SiteSettings = {
  profileName: "know_me",
  profileTagline: "记录、创造，也把每天真正会用的东西放在这里。",
  profileBio: "一个属于自己的数字入口：主页、博客和浏览器起始页，不再分散在不同服务里。",
  avatarUrl: "",
  quote: "生命如意志永存，青春永远年轻。",
  quoteAuthor: "今日短句",
  githubUrl: "",
  emailUrl: "",
  aboutUrl: "",
  homeBackgroundUrl: "",
  startBackgroundUrl: "",
  startPublic: false,
  defaultSearchEngine: "Bing",
  themeMode: "auto"
};

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare("SELECT value_json AS valueJson FROM settings WHERE key = ? LIMIT 1").get(key) as { valueJson: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  getDb().prepare(
    "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
  ).run(key, JSON.stringify(value), Date.now());
}

export function getSiteSettings(): SiteSettings {
  const stored = object(getSetting("site", {}));
  const engine: SearchEngineName =
    stored.defaultSearchEngine === "Google" || stored.defaultSearchEngine === "DuckDuckGo"
      ? stored.defaultSearchEngine
      : "Bing";
  const themeMode: ThemeMode = stored.themeMode === "dark" || stored.themeMode === "light" ? stored.themeMode : "auto";

  return {
    profileName: typeof stored.profileName === "string" ? stored.profileName : defaults.profileName,
    profileTagline: typeof stored.profileTagline === "string" ? stored.profileTagline : defaults.profileTagline,
    profileBio: typeof stored.profileBio === "string" ? stored.profileBio : defaults.profileBio,
    avatarUrl: typeof stored.avatarUrl === "string" ? stored.avatarUrl : defaults.avatarUrl,
    quote: typeof stored.quote === "string" ? stored.quote : defaults.quote,
    quoteAuthor: typeof stored.quoteAuthor === "string" ? stored.quoteAuthor : defaults.quoteAuthor,
    githubUrl: typeof stored.githubUrl === "string" ? stored.githubUrl : defaults.githubUrl,
    emailUrl: typeof stored.emailUrl === "string" ? stored.emailUrl : defaults.emailUrl,
    aboutUrl: typeof stored.aboutUrl === "string" ? stored.aboutUrl : defaults.aboutUrl,
    homeBackgroundUrl: typeof stored.homeBackgroundUrl === "string" ? stored.homeBackgroundUrl : defaults.homeBackgroundUrl,
    startBackgroundUrl: typeof stored.startBackgroundUrl === "string" ? stored.startBackgroundUrl : defaults.startBackgroundUrl,
    startPublic: stored.startPublic === true,
    defaultSearchEngine: engine,
    themeMode
  };
}

export function updateSiteSettings(input: Partial<SiteSettings>) {
  const current = getSiteSettings();
  const next: SiteSettings = {
    ...current,
    ...input,
    profileName: input.profileName?.slice(0, 100) ?? current.profileName,
    profileTagline: input.profileTagline?.slice(0, 240) ?? current.profileTagline,
    profileBio: input.profileBio?.slice(0, 1000) ?? current.profileBio,
    avatarUrl: input.avatarUrl?.slice(0, 1000) ?? current.avatarUrl,
    quote: input.quote?.slice(0, 500) ?? current.quote,
    quoteAuthor: input.quoteAuthor?.slice(0, 100) ?? current.quoteAuthor,
    githubUrl: input.githubUrl?.slice(0, 1000) ?? current.githubUrl,
    emailUrl: input.emailUrl?.slice(0, 1000) ?? current.emailUrl,
    aboutUrl: input.aboutUrl?.slice(0, 1000) ?? current.aboutUrl,
    homeBackgroundUrl: input.homeBackgroundUrl?.slice(0, 1000) ?? current.homeBackgroundUrl,
    startBackgroundUrl: input.startBackgroundUrl?.slice(0, 1000) ?? current.startBackgroundUrl,
    startPublic: input.startPublic ?? current.startPublic,
    defaultSearchEngine:
      input.defaultSearchEngine === "Google" || input.defaultSearchEngine === "DuckDuckGo" || input.defaultSearchEngine === "Bing"
        ? input.defaultSearchEngine
        : current.defaultSearchEngine,
    themeMode:
      input.themeMode === "dark" || input.themeMode === "light" || input.themeMode === "auto"
        ? input.themeMode
        : current.themeMode
  };
  setSetting("site", next);
  return next;
}
