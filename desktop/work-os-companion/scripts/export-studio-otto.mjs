/** Run after npm ci: node scripts/export-studio-otto.mjs
 * Generate bundled static art from the SAME component used by the app.
 * The temporary CommonJS directory lives here so the installed React resolves.
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(root, ".studio-export-"));
// Static SVGs have no timers, CSS animations, filters for the mark, or font dependencies.
const css = '.studio-otto{display:block;width:100%;height:100%}.studio-face{fill:none;stroke:var(--studio-phosphor);stroke-width:4.2;stroke-linecap:round;stroke-linejoin:round}.studio-dot-fill{fill:var(--studio-phosphor);stroke:none}';
try {
  writeFileSync(join(temp, "package.json"), '{"type":"commonjs"}');
  for (const [name, ext] of [["studioOttoPalette", "ts"], ["StudioOtto", "tsx"]]) {
    const source = readFileSync(join(root, "src", `${name}.${ext}`), "utf8").replace('import "./studio-otto.css";', "");
    const { outputText } = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020,
    }});
    writeFileSync(join(temp, `${name}.js`), outputText);
  }
  const require = createRequire(import.meta.url);
  const { StudioOtto } = require(join(temp, "StudioOtto.js"));
  for (const crop of ["full", "head"]) {
    const rendered = renderToStaticMarkup(React.createElement(StudioOtto, { pose: "idle", crop }));
    const svg = rendered.replace("<svg ", '<svg data-static="true" ').replace(/(<svg[^>]*>)/, `$1<style>${css}</style>`);
    writeFileSync(join(root, "public", crop === "head" ? "studio-otto-mark.svg" : "studio-otto.svg"), `${svg}\n`);
  }
  console.log("Exported Studio Otto full figure and mark.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
