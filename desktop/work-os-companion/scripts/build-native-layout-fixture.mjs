// Isolated production-built fixture; never adds an entry to the shipped app.
import { readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { build, loadConfigFromFile, mergeConfig } from "vite";

const entry = resolve("native-layout-audit.html");
const imports = [...(await readFile("src/main.tsx", "utf8")).matchAll(/^import "(\.\/[^\"]+\.css)";/gm)]
  .map((match) => `import ${JSON.stringify(match[1].replace("./", "/src/"))};`).join("\n");
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><div id="root"></div><script type="module">
import React from "react";
import {createRoot} from "react-dom/client";
import Onboarding from "/src/Onboarding";
import {PREVIEW_DATA} from "/src/OnboardingPreview";
${imports}
const data = {...PREVIEW_DATA, draft: {...PREVIEW_DATA.draft, step:"understood", updatedAt:"2026-10-20T00:00:00Z"}};
createRoot(document.getElementById("root")).render(React.createElement(Onboarding, {
 data, simulated:false, busy:false, onSubmit:async()=>undefined, onSaveDraft:async()=>undefined,
 onComplete:()=>undefined,onOpenDebug:()=>undefined,onLogout:()=>undefined,onNotify:()=>undefined
}));
</script></body></html>`;
try {
  await writeFile(entry, html, { flag: "wx" });
  const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, resolve("vite.config.ts"));
  if (!loaded) throw new Error("Companion Vite configuration not found");
  const config = mergeConfig(loaded.config, { configFile: false, build: { outDir: "native-layout-dist" } });
  config.build.rollupOptions.input = { nativeLayout: entry };
  await build(config);
} finally { await unlink(entry).catch(() => undefined); }
