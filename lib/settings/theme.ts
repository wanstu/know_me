import type { SiteSettings } from "./repository";

export function themeClass(settings: Pick<SiteSettings, "themeMode" | "themePreset">) {
  return "theme-" + settings.themeMode + " theme-preset-" + settings.themePreset;
}
