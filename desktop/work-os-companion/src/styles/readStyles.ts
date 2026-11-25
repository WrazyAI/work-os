import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STYLES_DIR = dirname(fileURLToPath(import.meta.url));

function readSheet(name: string): string {
  return readFileSync(resolve(STYLES_DIR, name), "utf8").replace(/\r\n/g, "\n");
}

/** Ordered base stylesheets (former `styles.css`). */
export function readBaseStyles(): string {
  return [readSheet("tokens-base.css"), readSheet("legacy-surfaces.css")].join("\n");
}

/** Ordered workspace stylesheets (former `workspace-redesign.css`). */
export function readWorkspaceStyles(): string {
  return [readSheet("workspace-shell.css"), readSheet("workspace-surfaces.css")].join("\n");
}

/** Dashboard surface stylesheet (former `dashboard-overhaul.css`). */
export function readDashboardStyles(): string {
  return readSheet("dashboard.css");
}

/** Complete ordered core stylesheet bundle. */
export function readAllCoreStyles(): string {
  return [readBaseStyles(), readWorkspaceStyles(), readDashboardStyles()].join("\n");
}
