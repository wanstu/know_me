export function openExternalBrowser(value: string, includeSameOrigin = false): boolean {
  let parsed: URL;
  try { parsed = new URL(value, window.location.href); } catch { return false; }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  if (!includeSameOrigin && parsed.origin === window.location.origin) return false;
  const bridge = (window as Window & {
    go?: { main?: { DesktopBridge?: { OpenExternalURL?: (uri: string) => Promise<void> } } }
  }).go?.main?.DesktopBridge;
  if (!bridge?.OpenExternalURL) return false;
  void bridge.OpenExternalURL(parsed.href).catch((error) => {
    console.error("打开系统浏览器失败", error);
  });
  return true;
}
