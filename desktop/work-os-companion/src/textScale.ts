/** The text-size build seam.
 *
 * The companion writes its text sizes in pixels, so changing a root font size
 * would move nothing. This PostCSS seam rewrites every `font-size`, `font`
 * shorthand, and fixed `line-height` written in pixels to
 * `calc(Npx * var(--text-scale, 1))`. One custom property then scales all text
 * across both windows without touching layout, icons, or spacing.
 *
 * Wired in `vite.config.ts`; the pure transform is unit-tested. */
const PX_LENGTH = /(\d*\.?\d+)px/g;

export function scaleTextDeclaration(prop: string, value: string): string {
  if (prop !== "font-size" && prop !== "font" && prop !== "line-height") return value;
  if (!value.includes("px")) return value;
  if (value.includes("var(--text-scale")) return value;
  return value.replace(PX_LENGTH, (_match, size: string) => `calc(${size}px * var(--text-scale, 1))`);
}

export function textScalePlugin() {
  return {
    postcssPlugin: "companion-text-scale",
    Declaration(decl: { prop: string; value: string }) {
      const next = scaleTextDeclaration(decl.prop, decl.value);
      if (next !== decl.value) decl.value = next;
    },
  };
}
