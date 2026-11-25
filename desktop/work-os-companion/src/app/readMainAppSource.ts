import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(APP_DIR, "..");

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) walkSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx") && entry !== "readMainAppSource.ts") {
      out.push(full);
    }
  }
  return out;
}

/** Concatenates `src/App.tsx` with all extracted main-window modules under `src/app/**`. */
export function readMainAppSource(): string {
  const files = [resolve(SRC_DIR, "App.tsx"), ...walkSourceFiles(APP_DIR)];
  return files.map((file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n")).join("\n");
}
