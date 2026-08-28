import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type ModelsCache = { models?: unknown[] } & Record<string, unknown>;

const CACHE_FIELD = "supports_reasoning_summaries";

export function repairCodexModelsCache(codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex")): void {
  const cachePath = path.join(codexHome, "models_cache.json");
  let tempPath: string | undefined;

  try {
    const cache = JSON.parse(readFileSync(cachePath, "utf8")) as ModelsCache;
    if (!Array.isArray(cache.models)) return;

    let changed = false;
    for (const model of cache.models) {
      if (!model || typeof model !== "object" || Array.isArray(model)) continue;
      const record = model as Record<string, unknown>;
      if (CACHE_FIELD in record) continue;
      record[CACHE_FIELD] = true;
      changed = true;
    }
    if (!changed) return;

    tempPath = `${cachePath}.repair-${process.pid}-${Date.now()}`;
    writeFileSync(tempPath, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, cachePath);
    tempPath = undefined;
  } catch {
    // Cache repair is best-effort; Codex can still fetch a fresh cache itself.
  } finally {
    if (tempPath) {
      try { unlinkSync(tempPath); } catch { /* best-effort cleanup */ }
    }
  }
}
