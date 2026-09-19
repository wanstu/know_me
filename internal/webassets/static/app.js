(() => {
  const saved = localStorage.getItem("know-me.native.theme") || "system";
  window.desktopKitTheme.apply(saved);

  async function refresh() {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const data = await response.json();
      document.getElementById("runtime").textContent = data.version + " · " + data.commit;
      document.getElementById("health").textContent = data.status === "ok" ? "healthy" : "error";
    } catch {
      document.getElementById("runtime").textContent = "unavailable";
      document.getElementById("health").textContent = "offline";
    }
  }

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const resolved = window.desktopKitTheme.getResolvedTheme();
    const next = resolved === "dark" ? "light" : "dark";
    window.desktopKitTheme.apply(next);
    localStorage.setItem("know-me.native.theme", next);
  });

  refresh();
})();
