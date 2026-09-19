const styles = [
  "/desktopkit/tokens.css",
  "/desktopkit-theme/aurora.css",
  "/desktopkit-theme/ocean.css",
  "/desktopkit-theme/forest.css",
  "/desktopkit-theme/sunset.css",
  "/desktopkit/base.css",
  "/desktopkit/components.css",
  "/desktopkit/navigation.css"
];

declare global {
  interface Window {
    desktopKitTheme?: {
      apply(mode: "light" | "dark" | "system"): string;
      setPack(name: string): string;
      getMode(): string;
      getResolvedTheme(): "light" | "dark";
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

export async function loadKitAssets() {
  styles.forEach(appendStyle);
  if (window.desktopKitTheme) return;
  await new Promise<void>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-know-me-kit-theme]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
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

export function applyTheme(mode: string, pack: string) {
  const normalizedMode = mode === "dark" || mode === "light" ? mode : "system";
  const normalizedPack = ["aurora", "ocean", "forest", "sunset"].includes(pack) ? pack : "aurora";
  if (window.desktopKitTheme) {
    window.desktopKitTheme.apply(normalizedMode);
    window.desktopKitTheme.setPack(normalizedPack);
  } else {
    const resolved =
      normalizedMode === "system"
        ? window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
        : normalizedMode;
    document.documentElement.dataset.dkTheme = resolved;
    document.documentElement.dataset.dkThemeMode = normalizedMode;
    document.documentElement.dataset.dkThemePack = normalizedPack;
  }
}
