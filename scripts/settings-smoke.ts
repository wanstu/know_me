import { getSiteSettings, updateSiteSettings } from "../lib/settings/repository";

const original = getSiteSettings();
try {
  const updated = updateSiteSettings({
    profileName: "know_me smoke",
    startPublic: !original.startPublic,
    defaultSearchEngine: "DuckDuckGo",
    themeMode: "light",
    startDensity: "compact"
  });
  if (updated.profileName !== "know_me smoke") throw new Error("profileName not saved");
  if (updated.startPublic === original.startPublic) throw new Error("startPublic not changed");
  if (getSiteSettings().defaultSearchEngine !== "DuckDuckGo") throw new Error("search engine not persisted");
  if (getSiteSettings().themeMode !== "light") throw new Error("theme mode not persisted");
  if (getSiteSettings().startDensity !== "compact") throw new Error("start density not persisted");
  console.log("settings smoke: PASS");
} finally {
  updateSiteSettings(original);
}
