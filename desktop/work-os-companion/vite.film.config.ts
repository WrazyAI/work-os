/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

/**
 * The filming build.
 *
 * `scripts/shoot-guide-films.mjs` photographs the real companion, which means it
 * needs the development-only scaffolding: the `?offline` fixture boot and the
 * `?preview-*` routes. It also needs the app to behave like the app — under the
 * dev server a single click re-renders this very large component tree slowly
 * enough to stall the capture for about a second, which would put a visible
 * freeze in the middle of every film, and would be a lie about how the product
 * actually performs.
 *
 * So this build keeps Vite's production pipeline (React in production mode,
 * esbuild minification) and only forces the development flags to stay true, so
 * the fixture entry points survive. It is a capture rig, never a shipped
 * artifact: nothing in `src-tauri` or the release workflow references it.
 */
export default mergeConfig(
  base,
  defineConfig({
    define: {
      "import.meta.env.DEV": "true",
      "import.meta.env.PROD": "false",
    },
    build: { outDir: "dist-film", sourcemap: false },
  }),
);
