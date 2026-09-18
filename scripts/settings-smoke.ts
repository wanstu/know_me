import { getSiteSettings, updateSiteSettings } from "../lib/settings/repository";

const original = getSiteSettings();
try {
  const updated = updateSiteSettings({
    profileName: "know_me smoke",
    startPublic: !original.startPublic,
    defaultSearchEngine: "DuckDuckGo",
    themeMode: "light",
    themePreset: "forest",
    startDensity: "compact",
    startCardOpacity: 72,
    startCardRadius: 18,
    startBackgroundDim: 44,
    socialLinks: [{ id: "smoke-social", label: "Docs", url: "https://example.com/docs" }],
    homeEntries: [{ id: "smoke-entry", name: "Smoke", description: "Entry", url: "/blog", newTab: false }],
    projects: [{ id: "smoke-project", name: "Smoke Project", description: "Project", url: "https://example.com/project", tag: "Test" }]
  });
  if (updated.profileName !== "know_me smoke") throw new Error("profileName not saved");
  if (updated.startPublic === original.startPublic) throw new Error("startPublic not changed");
  if (getSiteSettings().defaultSearchEngine !== "DuckDuckGo") throw new Error("search engine not persisted");
  if (getSiteSettings().themeMode !== "light") throw new Error("theme mode not persisted");
  if (getSiteSettings().themePreset !== "forest") throw new Error("theme preset not persisted");
  if (getSiteSettings().startDensity !== "compact") throw new Error("start density not persisted");
  if (getSiteSettings().startCardOpacity !== 72) throw new Error("start card opacity not persisted");
  if (getSiteSettings().startCardRadius !== 18) throw new Error("start card radius not persisted");
  if (getSiteSettings().startBackgroundDim !== 44) throw new Error("start background dim not persisted");
  if (getSiteSettings().socialLinks[0]?.label !== "Docs") throw new Error("social links not persisted");
  if (getSiteSettings().homeEntries[0]?.name !== "Smoke") throw new Error("home entries not persisted");
  if (getSiteSettings().projects[0]?.name !== "Smoke Project") throw new Error("projects not persisted");
  console.log("settings smoke: PASS");
} finally {
  updateSiteSettings(original);
}
