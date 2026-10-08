let desktopBrowserMode = false;

export function setDesktopBrowserMode(enabled: boolean) {
  desktopBrowserMode = enabled;
}

/**
 * Desktop frontend is served from an HTTP origin rather than the Wails bootstrap
 * origin. The Wails JS bridge does NOT survive location.replace(coreURL).
 * Use the authenticated-by-origin loopback Core endpoint instead.
 */
export function openExternalBrowser(value: string, includeSameOrigin = false): boolean {
  let parsed: URL;
  try { parsed = new URL(value, window.location.href); } catch { return false; }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  if (!includeSameOrigin && parsed.origin === window.location.origin) return false;
  if (!desktopBrowserMode) return false;

  void fetch("/api/desktop/open-external", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ url: parsed.href })
  }).then(async (response) => {
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result?.error || `HTTP ${response.status}`);
    }
  }).catch((error) => {
    console.error("系统浏览器打开失败", error);
    window.alert("无法在系统浏览器打开链接，请稍后重试或复制链接地址。");
  });
  return true;
}
