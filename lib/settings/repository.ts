import { getDb } from "@/lib/db";

export type SearchEngineName = "Bing" | "Google" | "DuckDuckGo";
export type ThemeMode = "auto" | "dark" | "light";
export type ThemePreset = string;
export type StartDensity = "compact" | "comfortable" | "spacious";
export type SocialLink = { id: string; label: string; url: string };
export type HomeEntry = { id: string; name: string; description: string; url: string; newTab: boolean };
export type ProjectEntry = { id: string; name: string; description: string; url: string; tag: string };
export type FriendLink = { id: string; name: string; url: string; visible: boolean };

export type SiteSettings = {
  profileName: string;
  profileTagline: string;
  profileBio: string;
  avatarUrl: string;
  quote: string;
  quoteAuthor: string;
  quoteEnabled: boolean;
  quoteAuthorEnabled: boolean;
  githubUrl: string;
  emailUrl: string;
  aboutUrl: string;
  homeBackgroundUrl: string;
  startBackgroundUrl: string;
  startPublic: boolean;
  defaultSearchEngine: SearchEngineName;
  themeMode: ThemeMode;
  themePreset: ThemePreset;
  startDensity: StartDensity;
  startCardOpacity: number;
  startCardRadius: number;
  startBackgroundDim: number;
  socialLinks: SocialLink[];
  homeEntries: HomeEntry[];
  projects: ProjectEntry[];
  showIcp: boolean;
  icpNumber: string;
  icpUrl: string;
  showPolice: boolean;
  policeNumber: string;
  policeUrl: string;
  footerText: string;
  showFriendLinks: boolean;
  friendLinks: FriendLink[];
};

const defaults: SiteSettings = {
  profileName: "know_me",
  profileTagline: "记录、创造，也把每天真正会用的东西放在这里。",
  profileBio: "一个属于自己的数字入口：主页、博客和浏览器起始页，不再分散在不同服务里。",
  avatarUrl: "",
  quote: "生命如意志永存，青春永远年轻。",
  quoteAuthor: "今日短句",
  quoteEnabled: true,
  quoteAuthorEnabled: true,
  githubUrl: "",
  emailUrl: "",
  aboutUrl: "",
  homeBackgroundUrl: "",
  startBackgroundUrl: "",
  startPublic: false,
  defaultSearchEngine: "Bing",
  themeMode: "auto",
  themePreset: "aurora",
  startDensity: "comfortable",
  startCardOpacity: 64,
  startCardRadius: 22,
  startBackgroundDim: 62,
  socialLinks: [],
  homeEntries: [
    { id: "blog", name: "Blog", description: "文章与笔记", url: "/blog", newTab: false },
    { id: "start", name: "Start", description: "浏览器起始页", url: "/start", newTab: false },
    { id: "projects", name: "Projects", description: "项目与作品", url: "#projects", newTab: false },
    { id: "archive", name: "Archive", description: "文章归档", url: "/blog#archive", newTab: false },
    { id: "about", name: "About", description: "关于我", url: "#about", newTab: false },
    { id: "admin", name: "Admin", description: "管理后台", url: "/admin", newTab: false }
  ],
  projects: [],
  showIcp: false,
  icpNumber: "",
  icpUrl: "",
  showPolice: false,
  policeNumber: "",
  policeUrl: "",
  footerText: "",
  showFriendLinks: false,
  friendLinks: []
};

function validThemePreset(value: unknown): value is ThemePreset {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeSocialLinks(value: unknown, fallback: SocialLink[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 20).map((entry, index) => {
    const row = object(entry);
    return {
      id: text(row.id, 80) || "social-" + index,
      label: text(row.label, 80),
      url: text(row.url, 1000)
    };
  }).filter((entry) => entry.label && entry.url);
}

function normalizeHomeEntries(value: unknown, fallback: HomeEntry[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 24).map((entry, index) => {
    const row = object(entry);
    return {
      id: text(row.id, 80) || "entry-" + index,
      name: text(row.name, 80),
      description: text(row.description, 160),
      url: text(row.url, 1000),
      newTab: row.newTab === true
    };
  }).filter((entry) => entry.name && entry.url);
}

function normalizeProjects(value: unknown, fallback: ProjectEntry[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 24).map((entry, index) => {
    const row = object(entry);
    return {
      id: text(row.id, 80) || "project-" + index,
      name: text(row.name, 100),
      description: text(row.description, 300),
      url: text(row.url, 1000),
      tag: text(row.tag, 80)
    };
  }).filter((entry) => entry.name);
}

function normalizeFriendLinks(value: unknown, fallback: FriendLink[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 40).map((entry, index) => {
    const row = object(entry);
    return {
      id: text(row.id, 80) || "friend-" + index,
      name: text(row.name, 100),
      url: text(row.url, 1000),
      visible: row.visible !== false
    };
  }).filter((entry) => entry.name && entry.url);
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
  const themePreset: ThemePreset = validThemePreset(stored.themePreset) ? stored.themePreset : "aurora";
  const startDensity: StartDensity = stored.startDensity === "compact" || stored.startDensity === "spacious" ? stored.startDensity : "comfortable";
  const githubUrl = typeof stored.githubUrl === "string" ? stored.githubUrl : defaults.githubUrl;
  const emailUrl = typeof stored.emailUrl === "string" ? stored.emailUrl : defaults.emailUrl;
  const aboutUrl = typeof stored.aboutUrl === "string" ? stored.aboutUrl : defaults.aboutUrl;
  const legacySocialLinks: SocialLink[] = [
    githubUrl ? { id: "github", label: "GitHub", url: githubUrl } : null,
    emailUrl ? { id: "mail", label: "Mail", url: emailUrl } : null,
    aboutUrl ? { id: "about", label: "About", url: aboutUrl } : null
  ].filter((item): item is SocialLink => Boolean(item));

  return {
    profileName: typeof stored.profileName === "string" ? stored.profileName : defaults.profileName,
    profileTagline: typeof stored.profileTagline === "string" ? stored.profileTagline : defaults.profileTagline,
    profileBio: typeof stored.profileBio === "string" ? stored.profileBio : defaults.profileBio,
    avatarUrl: typeof stored.avatarUrl === "string" ? stored.avatarUrl : defaults.avatarUrl,
    quote: typeof stored.quote === "string" ? stored.quote : defaults.quote,
    quoteAuthor: typeof stored.quoteAuthor === "string" ? stored.quoteAuthor : defaults.quoteAuthor,
    quoteEnabled: typeof stored.quoteEnabled === "boolean" ? stored.quoteEnabled : defaults.quoteEnabled,
    quoteAuthorEnabled: typeof stored.quoteAuthorEnabled === "boolean" ? stored.quoteAuthorEnabled : defaults.quoteAuthorEnabled,
    githubUrl,
    emailUrl,
    aboutUrl,
    homeBackgroundUrl: typeof stored.homeBackgroundUrl === "string" ? stored.homeBackgroundUrl : defaults.homeBackgroundUrl,
    startBackgroundUrl: typeof stored.startBackgroundUrl === "string" ? stored.startBackgroundUrl : defaults.startBackgroundUrl,
    startPublic: stored.startPublic === true,
    defaultSearchEngine: engine,
    themeMode,
    themePreset,
    startDensity,
    startCardOpacity: typeof stored.startCardOpacity === "number" ? clamp(stored.startCardOpacity, 30, 95) : defaults.startCardOpacity,
    startCardRadius: typeof stored.startCardRadius === "number" ? clamp(stored.startCardRadius, 12, 32) : defaults.startCardRadius,
    startBackgroundDim: typeof stored.startBackgroundDim === "number" ? clamp(stored.startBackgroundDim, 0, 90) : defaults.startBackgroundDim,
    socialLinks: normalizeSocialLinks(stored.socialLinks, legacySocialLinks),
    homeEntries: normalizeHomeEntries(stored.homeEntries, defaults.homeEntries),
    projects: normalizeProjects(stored.projects, defaults.projects),
    showIcp: stored.showIcp === true,
    icpNumber: typeof stored.icpNumber === "string" ? stored.icpNumber : defaults.icpNumber,
    icpUrl: typeof stored.icpUrl === "string" ? stored.icpUrl : defaults.icpUrl,
    showPolice: stored.showPolice === true,
    policeNumber: typeof stored.policeNumber === "string" ? stored.policeNumber : defaults.policeNumber,
    policeUrl: typeof stored.policeUrl === "string" ? stored.policeUrl : defaults.policeUrl,
    footerText: typeof stored.footerText === "string" ? stored.footerText : defaults.footerText,
    showFriendLinks: stored.showFriendLinks === true,
    friendLinks: normalizeFriendLinks(stored.friendLinks, defaults.friendLinks)
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
    quoteEnabled: input.quoteEnabled ?? current.quoteEnabled,
    quoteAuthorEnabled: input.quoteAuthorEnabled ?? current.quoteAuthorEnabled,
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
        : current.themeMode,
    themePreset: validThemePreset(input.themePreset) ? input.themePreset : current.themePreset,
    startDensity:
      input.startDensity === "compact" || input.startDensity === "comfortable" || input.startDensity === "spacious"
        ? input.startDensity
        : current.startDensity,
    startCardOpacity: typeof input.startCardOpacity === "number" ? clamp(input.startCardOpacity, 30, 95) : current.startCardOpacity,
    startCardRadius: typeof input.startCardRadius === "number" ? clamp(input.startCardRadius, 12, 32) : current.startCardRadius,
    startBackgroundDim: typeof input.startBackgroundDim === "number" ? clamp(input.startBackgroundDim, 0, 90) : current.startBackgroundDim,
    socialLinks: input.socialLinks === undefined ? current.socialLinks : normalizeSocialLinks(input.socialLinks, current.socialLinks),
    homeEntries: input.homeEntries === undefined ? current.homeEntries : normalizeHomeEntries(input.homeEntries, current.homeEntries),
    projects: input.projects === undefined ? current.projects : normalizeProjects(input.projects, current.projects),
    showIcp: input.showIcp ?? current.showIcp,
    icpNumber: input.icpNumber?.slice(0, 120) ?? current.icpNumber,
    icpUrl: input.icpUrl?.slice(0, 1000) ?? current.icpUrl,
    showPolice: input.showPolice ?? current.showPolice,
    policeNumber: input.policeNumber?.slice(0, 120) ?? current.policeNumber,
    policeUrl: input.policeUrl?.slice(0, 1000) ?? current.policeUrl,
    footerText: input.footerText?.slice(0, 500) ?? current.footerText,
    showFriendLinks: input.showFriendLinks ?? current.showFriendLinks,
    friendLinks: input.friendLinks === undefined ? current.friendLinks : normalizeFriendLinks(input.friendLinks, current.friendLinks)
  };
  setSetting("site", next);
  return next;
}
