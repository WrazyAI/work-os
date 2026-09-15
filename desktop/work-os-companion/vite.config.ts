/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ["react", "react-dom"] },
  // The monorepo root has its own postcss.config.mjs (for the web app). This
  // inline config stops Vite/Vitest from searching upward and trying to load
  // plugins that the companion package does not install. Tailwind here comes
  // from @tailwindcss/vite, not PostCSS.
  css: { postcss: { plugins: [] } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Dev-fixture only (mirrors the ?preview-* bootstrap): when the browser
    // build runs against the deployed Work OS API through ?token=, the API
    // base is this dev server itself, and /api is proxied so browser E2E
    // suites stay same-origin (the API sends no CORS headers by design).
    proxy: process.env.VITE_WORK_OS_API_PROXY
      ? { "/api": { target: process.env.VITE_WORK_OS_API_PROXY, changeOrigin: true, secure: true } }
      : undefined,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        debug: resolve(__dirname, "debug.html"),
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
