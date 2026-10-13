/** Known browser-visible routes and anchors; keep custom URLs editable. */
export const HOME_ENTRY_LINK_PRESETS = [
  { label: "个人主页", url: "/", group: "站内页面" },
  { label: "Start 起始页", url: "/start", group: "站内页面" },
  { label: "文章列表", url: "/blog", group: "站内页面" },
  { label: "文章归档", url: "/blog#archive", group: "站内页面" },
  { label: "RSS 订阅", url: "/feed.xml", group: "站内页面" },
  { label: "项目与作品（需有项目）", url: "#projects", group: "主页区块" },
  { label: "关于我（需填写简介）", url: "#about", group: "主页区块" },
  { label: "最近文章（需有文章）", url: "#recent-posts", group: "主页区块" },
  { label: "管理后台（需登录）", url: "/admin", group: "管理功能" },
  { label: "站点设置（需登录）", url: "/admin/settings", group: "管理功能" },
  { label: "登录页面", url: "/login", group: "管理功能" }
] as const;

export function homeEntryPreset(value: string): string {
  return HOME_ENTRY_LINK_PRESETS.some((preset) => preset.url === value.trim()) ? value.trim() : "";
}

/** Compatible with public safeHref: no executable schemes or protocol-relative URL. */
export function validHomeEntryLink(value: string): boolean {
  const text = value.trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) return false;
  if (text.startsWith("/")) return !text.startsWith("//") && !text.includes("\\");
  if (text.startsWith("#")) return text.length > 1;
  try {
    const url = new URL(text);
    if (url.protocol === "mailto:") return Boolean(url.pathname) && !url.username;
    return (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
