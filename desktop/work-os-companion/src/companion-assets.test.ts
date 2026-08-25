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
    expect(app).not.toContain('src="/work-os-companion.png"');
  });

  it("uses an alpha PNG for the packaged app icon", () => {
    expect(pngColorType(resolve(root, "src-tauri/icons/icon.png"))).toBe(6);
  });
});
