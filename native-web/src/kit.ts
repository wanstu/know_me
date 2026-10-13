const styles = [
  "/desktopkit/tokens.css",
  "/desktopkit/base.css",
  "/desktopkit/components.css",
  "/desktopkit/navigation.css"
];

export type ThemeStyle = "solid" | "gradient";

export type ThemePackInfo = {
  name: string;
  display_name: string;
  description: string;
  file: string;
  sha256: string;
  gradient_light?: string;
  gradient_dark?: string;
  gradient_light_secondary?: string;
  gradient_dark_secondary?: string;
};

export type ThemeCatalog = {
  schema_version: number;
  revision?: string;
  source: "builtin" | "cache" | "remote" | string;
  stale: boolean;
  last_error?: string;
  packs: ThemePackInfo[];
};

declare global {
  interface Window {
    desktopKitTheme?: {
      apply(mode: "light" | "dark" | "system"): string;
      getMode(): string;
      getResolvedTheme(): "light" | "dark";
      setPack(name: string): string;
      getPack(): string;
      clearPack(): void;
      applyPack(name: string): Promise<string>;
      clearAppliedPack(): void;
      loadCatalog(options?: { refresh?: boolean }): Promise<ThemeCatalog>;
      refreshCatalog(): Promise<ThemeCatalog>;
      getCatalog(): ThemeCatalog | null;
      applyGradient(names: string[]): Promise<string[]>;
      clearGradient(): void;
      getGradientPacks(): string[];
      getStyle(): ThemeStyle;
      dispose(): void;
    };
  }
}

function appendStyle(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

async function ensureThemeScript() {
  if (window.desktopKitTheme) return;
  await new Promise<void>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-know-me-kit-theme]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => resolve(), { once: true });
      if (window.desktopKitTheme) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "/desktopkit/theme.js";
    script.dataset.knowMeKitTheme = "1";
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

export async function loadKitAssets() {
  styles.forEach(appendStyle);
  await ensureThemeScript();
  if (window.desktopKitTheme) {
    void window.desktopKitTheme.loadCatalog().catch(() => undefined);
  }
}

function normalizedMode(mode: string): "light" | "dark" | "system" {
  return mode === "dark" || mode === "light" ? mode : "system";
}

function normalizedPack(pack: string) {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(pack) ? pack : "aurora";
}

export function validGradientPacks(packs: string[]): boolean {
  return packs.length >= 2 && packs.length <= 4 &&
    new Set(packs).size === packs.length &&
    packs.every((pack) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(pack));
}

let legacyCatalogRefresh: Promise<ThemeCatalog> | null = null;

export async function loadThemeCatalog(refresh = false): Promise<ThemeCatalog> {
  await ensureThemeScript();
  if (window.desktopKitTheme) {
    const runtime = window.desktopKitTheme;
    const result = refresh ? await runtime.refreshCatalog() : await runtime.loadCatalog();
    // Kit v0.12 can read a shared v0.11 cache that lacks gradient metadata.
    // Probe the newer Theme catalog automatically rather than requiring a manual refresh.
    if (!refresh && !result.packs.some((pack) => pack.gradient_light && pack.gradient_dark)) {
      legacyCatalogRefresh ??= runtime.refreshCatalog();
      return legacyCatalogRefresh;
    }
    return result;
  }
  const response = await fetch("/desktopkit-theme/manifest.json" + (refresh ? "?refresh=1" : ""), { cache: "no-store" });
  if (!response.ok) throw new Error("theme_catalog_failed");
  return response.json() as Promise<ThemeCatalog>;
}

export type ThemeApplyResult = { applied: ThemeStyle; warning?: string };

let themeRevision = 0;

export async function applyTheme(
  mode: string,
  pack: string,
  style: ThemeStyle = "solid",
  gradientPacks: string[] = []
): Promise<ThemeApplyResult> {
  const revision = ++themeRevision;
  const nextMode = normalizedMode(mode);
  const nextPack = normalizedPack(pack);
  await ensureThemeScript();
  if (revision !== themeRevision) return { applied: style };

  const runtime = window.desktopKitTheme;
  if (runtime) {
    runtime.apply(nextMode);
    try {
      if (style === "gradient") {
        await loadThemeCatalog(false);
      } else if (!runtime.getCatalog()) {
        await runtime.loadCatalog();
      }
      if (revision !== themeRevision) return { applied: style };
      if (style === "gradient") {
        if (!validGradientPacks(gradientPacks)) throw new Error("请选择 2～4 个不同的基础主题");
        await runtime.applyGradient(gradientPacks);
        if (revision !== themeRevision) {
          runtime.clearGradient();
          return { applied: "solid" };
        }
        return { applied: "gradient" };
      }
      runtime.clearGradient();
      await runtime.applyPack(nextPack);
      return { applied: "solid" };
    } catch (error) {
      runtime.clearGradient();
      if (revision !== themeRevision) return { applied: "solid" };
      try {
        await runtime.applyPack(nextPack);
      } catch {
        if (nextPack !== "aurora") await runtime.applyPack("aurora").catch(() => undefined);
      }
      return {
        applied: "solid",
        warning: error instanceof Error ? error.message : "主题加载失败，已回退到普通主题"
      };
    }
  }

  const resolved = nextMode === "system"
    ? window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : nextMode;
  document.documentElement.dataset.dkTheme = resolved;
  document.documentElement.dataset.dkThemeMode = nextMode;
  document.documentElement.dataset.dkThemePack = nextPack;
  document.documentElement.removeAttribute("data-dk-theme-style");
  return { applied: "solid", warning: style === "gradient" ? "渐变主题暂不可用" : undefined };
}
