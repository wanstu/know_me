function safeBackground(url: string) {
  const value = url.trim();
  if (/^https?:\/\//i.test(value) || value.startsWith("/media/")) return value;
  return "";
}

export function AmbientWallpaper({ url = "" }: { url?: string }) {
  const safe = safeBackground(url);
  const style = safe
    ? {
        backgroundImage:
          "radial-gradient(circle at 22% 18%, rgba(243,139,120,.28), transparent 30%)," +
          "radial-gradient(circle at 76% 34%, rgba(73,170,232,.32), transparent 34%)," +
          "linear-gradient(128deg, rgba(27,26,42,.38), rgba(8,18,30,.7))," +
          "url(" + JSON.stringify(safe) + ")",
        backgroundSize: "auto, auto, auto, cover",
        backgroundPosition: "center, center, center, center"
      }
    : undefined;

  return <div className="ambient-wallpaper" style={style} aria-hidden="true" />;
}
