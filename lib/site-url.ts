export function getSiteUrl() {
  const configured = process.env.SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return "http://127.0.0.1:3000";
}
