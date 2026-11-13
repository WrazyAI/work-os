import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const css = readFileSync(resolve(root, "theme.css"), "utf8").replace(/\r\n/g, "\n");

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
}

function tokens(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((match) => [match[1], match[2].toLowerCase()]),
  );
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255);
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

const darkBlock = block(':root[data-theme="dark"]');
const dark = tokens(darkBlock);
const darkNames = new Set([...darkBlock.matchAll(/--([\w-]+):/g)].map((match) => match[1]));

const pairs: [string, string, number][] = [
  ["ink", "canvas", 4.5], ["ink", "surface", 4.5], ["ink", "raised", 4.5],
  ["ink-soft", "surface", 4.5], ["muted", "canvas", 4.5], ["muted", "surface", 4.5],
  ["muted", "raised", 4.5], ["danger", "surface", 4.5], ["warning", "surface", 4.5],
  ["observed", "surface", 4.5], ["signal", "surface", 4.5], ["ink-on-signal", "signal", 4.5],
  ["focus", "surface", 3.0],
];

describe("soft ash theme tokens", () => {
  it("meets every text and focus contrast floor", () => {
    for (const [foreground, background, floor] of pairs) {
      const fg = dark.get(foreground);
      const bg = dark.get(background);
      expect(fg, `--${foreground} missing from the dark block`).toBeDefined();
      expect(bg, `--${background} missing from the dark block`).toBeDefined();
      expect(contrast(fg!, bg!), `${foreground} on ${background}`).toBeGreaterThanOrEqual(floor);
    }
  });

  it("overrides every surface group so no group keeps a light-only palette", () => {
    for (const token of ["dash-ink", "sidebar-ink", "conversation-ink", "tool-ink", "ob-line", "avatar-ink", "wc-bar"]) {
      expect(darkNames.has(token), `--${token} missing from the dark block`).toBe(true);
    }
  });

  it("defines all eight chart hues in both materials", () => {
    for (let index = 1; index <= 8; index += 1) {
      expect(css.match(new RegExp(`--chart-${index}:`, "g"))?.length ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it("never scales text or mascot art from the theme block", () => {
    expect(dark.has("text-scale")).toBe(false);
    expect(dark.has("mascot-scale")).toBe(false);
  });
});
