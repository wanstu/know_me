import { getSiteSettings, updateSiteSettings } from "../lib/settings/repository";

const original = getSiteSettings();
try {
  const updated = updateSiteSettings({
    profileName: "know_me smoke",
    startPublic: !original.startPublic,
    defaultSearchEngine: "DuckDuckGo"
  });
  if (updated.profileName !== "know_me smoke") throw new Error("profileName not saved");
  if (updated.startPublic === original.startPublic) throw new Error("startPublic not changed");
  if (getSiteSettings().defaultSearchEngine !== "DuckDuckGo") throw new Error("search engine not persisted");
  console.log("settings smoke: PASS");
} finally {
  updateSiteSettings(original);
}
