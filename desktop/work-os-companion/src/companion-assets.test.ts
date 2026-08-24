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

function webpHasAlpha(path: string) {
  const buf = readFileSync(path);
  expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(buf.subarray(8, 12).toString("ascii")).toBe("WEBP");
  return buf.includes(Buffer.from("ALPH"));
}

describe("companion artwork", () => {
  it("ships an alpha WebP so the checkerboard never renders", () => {
    expect(webpHasAlpha(resolve(root, "src/assets/workday-focus.webp"))).toBe(true);
  });

  it("composites the companion over dark UI without screen blending", () => {
    const css = readFileSync(resolve(root, "src/styles.css"), "utf8");
    expect(css).toMatch(/\.companion\s*\{[^}]*position:\s*absolute/);
    expect(css).not.toMatch(/\.companion\s*\{[^}]*mix-blend-mode:\s*screen/);
    expect(css).not.toMatch(/\.connect\s*>\s*aside img\s*\{[^}]*mix-blend-mode:\s*screen/);
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toContain('from "./assets/workday-focus.webp"');
    expect(app).not.toContain('from "./assets/work-os-companion.png"');
  });

  it("uses an alpha PNG for the packaged app icon", () => {
    expect(pngColorType(resolve(root, "src-tauri/icons/icon.png"))).toBe(6);
  });
});
