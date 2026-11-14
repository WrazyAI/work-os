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
  ["focus", "surface", 3.0], ["warning-ink", "warning-soft", 4.5], ["ink", "canvas", 4.5],
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

  it("keeps chart hues distinct from each other and from semantic roles", () => {
    const rgb = (hex: string) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    const distance = (left: string, right: string) => Math.sqrt(rgb(left).reduce((sum, value, index) => sum + (value - rgb(right)[index]!) ** 2, 0));
    const hues = [...Array(8)].map((_, index) => dark.get(`chart-${index + 1}`));
    for (const hue of hues) expect(hue).toBeDefined();
    for (const semantic of ["signal", "danger", "warning", "observed"]) {
      for (const hue of hues) expect(distance(hue!, dark.get(semantic)!), `${hue} vs ${semantic}`).toBeGreaterThan(40);
    }
    for (let left = 0; left < hues.length; left += 1) {
      for (let right = left + 1; right < hues.length; right += 1) {
        expect(distance(hues[left]!, hues[right]!), `chart-${left + 1} vs chart-${right + 1}`).toBeGreaterThan(20);
      }
    }
    expect(dark.get("chart-ink")).not.toBe(dark.get("chart-4"));
  });

  it("sets the inherited foreground for dark surfaces", () => {
    expect(darkBlock).toContain("color: var(--ink);");
  });

  it("defines line-strong for the light material", () => {
    const light = block(":root");
    expect(new Set([...light.matchAll(/--([\w-]+):/g)].map((match) => match[1])).has("line-strong")).toBe(true);
  });

  it("never scales text or mascot art from the theme block", () => {
    expect(darkNames.has("text-scale")).toBe(false);
    expect(darkNames.has("mascot-scale")).toBe(false);
  });
});
