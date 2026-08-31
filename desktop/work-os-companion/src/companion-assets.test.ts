import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function pngColorType(path: string) {
  const buf = readFileSync(path);
  expect(buf.subarray(0, 8).toString("binary")).toBe("\x89PNG\r\n\x1a\n");
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return buf[25];
}

describe("companion artwork", () => {
  it("ships a true-alpha PNG so the checkerboard never renders", () => {
    expect(pngColorType(resolve(root, "public/work-os-companion.png"))).toBe(6);
    expect(pngColorType(resolve(root, "src/assets/work-os-task-stack-v2.png"))).toBe(6);
  });

  it("composites the companion over dark UI without screen blending", () => {
    const css = readFileSync(resolve(root, "src/styles.css"), "utf8");
    expect(css).toMatch(/\.companion\s*\{[^}]*position:\s*absolute/);
    expect(css).not.toMatch(/\.companion\s*\{[^}]*mix-blend-mode:\s*screen/);
    expect(css).not.toMatch(/\.connect\s*>\s*aside img\s*\{[^}]*mix-blend-mode:\s*screen/);
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toContain('from "./assets/work-os-task-stack-v2.png"');
    expect(app).not.toContain('from "./assets/work-os-companion.png"');
  });

  it("includes the redesign styles in the packaged application entrypoint", () => {
    const main = readFileSync(resolve(root, "src/main.tsx"), "utf8");
    expect(main).toContain('import "./styles.css"');
    expect(main).toContain('import "./workspace-redesign.css"');
    expect(readFileSync(resolve(root, "src/App.tsx"), "utf8")).toContain('import "./plan-insights.css"');
    expect(readFileSync(resolve(root, "src/workspace-redesign.css"), "utf8")).toContain(".workspace");
  });

  it("uses an alpha PNG for the packaged app icon", () => {
    expect(pngColorType(resolve(root, "src-tauri/icons/icon.png"))).toBe(6);
  });
});

describe("companion launch window", () => {
  it("opens at the polished desktop viewport instead of the compressed layout", () => {
    const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
    const mainWindow = config.app.windows.find((window: { label?: string }) => window.label === "main");

    expect(mainWindow).toMatchObject({
      width: 1000,
      height: 960,
      center: true,
      resizable: true,
    });
  });
});
