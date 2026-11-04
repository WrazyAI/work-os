import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("packaged startup creates only product windows, not the opt-in debugger", () => {
  const config = JSON.parse(readFileSync(new URL("../desktop/work-os-companion/src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.deepEqual(config.app.windows.filter((window: any) => window.create !== false).map((window: any) => window.label), ["main", "avatar"]);
  for (const window of config.app.windows.filter((window: any) => window.label !== "debug")) {
    assert(window.additionalBrowserArgs.includes("--disable-background-timer-throttling"), "voice completion keeps its required background flag");
  }
});
