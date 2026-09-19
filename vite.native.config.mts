import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: path.resolve(import.meta.dirname, "native-web"),
  plugins: [react()],
  resolve: {
    alias: {
      "@native": path.resolve(import.meta.dirname, "native-web/src")
    }
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "internal/webassets/static"),
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/api": "http://127.0.0.1:3041",
      "/media": "http://127.0.0.1:3041",
      "/desktopkit": "http://127.0.0.1:3041",
      "/desktopkit-theme": "http://127.0.0.1:3041"
    }
  }
});
