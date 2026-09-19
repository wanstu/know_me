const styles = [
  "/desktopkit/tokens.css",
  "/desktopkit/base.css",
  "/desktopkit/components.css",
  "/desktopkit/navigation.css"
];

export type ThemePackInfo = {
  name: string;
  display_name: string;
  description: string;
  file: string;
  sha256: string;
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

export async function loadThemeCatalog(refresh = false): Promise<ThemeCatalog> {
  await ensureThemeScript();
  if (window.desktopKitTheme) {
    return refresh
      ? window.desktopKitTheme.refreshCatalog()
      : window.desktopKitTheme.loadCatalog();
  }
  const response = await fetch("/desktopkit-theme/manifest.json" + (refresh ? "?refresh=1" : ""), { cache: "no-store" });
  if (!response.ok) throw new Error("theme_catalog_failed");
  return response.json() as Promise<ThemeCatalog>;
}

export async function applyTheme(mode: string, pack: string) {
  const nextMode = normalizedMode(mode);
  const nextPack = normalizedPack(pack);
  await ensureThemeScript();

  if (window.desktopKitTheme) {
    window.desktopKitTheme.apply(nextMode);
    try {
      if (!window.desktopKitTheme.getCatalog()) {
        await window.desktopKitTheme.loadCatalog();
      }
      await window.desktopKitTheme.applyPack(nextPack);
      return;
    } catch {
      if (nextPack !== "aurora") {
        try {
          await window.desktopKitTheme.applyPack("aurora");
          return;
        } catch {}
      }
    }
  }

  const resolved =
    nextMode === "system"
      ? window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      : nextMode;
  document.documentElement.dataset.dkTheme = resolved;
  document.documentElement.dataset.dkThemeMode = nextMode;
  document.documentElement.dataset.dkThemePack = nextPack;
}
