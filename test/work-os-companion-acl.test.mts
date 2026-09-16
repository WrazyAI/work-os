import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/** Guards the Tauri v2 ACL against frontend/backend drift.
 *
 * The companion registers local commands in `src-tauri/src/lib.rs` and grants
 * them through `src-tauri/permissions/*.toml`, which windows receive via
 * `src-tauri/capabilities/*.json`. A command that is registered but not granted
 * fails at runtime with "Command <name> not allowed by ACL" — exactly how the
 * updater's exit watchdog was broken. This test walks the real files, resolves
 * which windows can reach each `invoke()` call, and asserts every call is both
 * registered and granted for those windows. */

const root = resolve(import.meta.dirname, "..");
const companion = resolve(root, "desktop/work-os-companion");
const tauri = resolve(companion, "src-tauri");
const source = resolve(companion, "src");

function read(path: string) {
  return readFileSync(path, "utf8");
}

// --- 1. Registered commands -------------------------------------------------

const handler = read(resolve(tauri, "src/lib.rs")).match(/generate_handler!\[([\s\S]*?)\]/);
assert.ok(handler, "src-tauri/src/lib.rs must register commands through generate_handler!");
const registered = new Set(
  handler[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split("::").pop()!.trim()),
);
assert.ok(registered.size >= 8, `expected at least 8 registered commands, found ${registered.size}`);

// --- 2. Local permission grants --------------------------------------------

const permissionCommands = new Map<string, Set<string>>();
for (const file of readdirSync(resolve(tauri, "permissions"))) {
  if (!file.endsWith(".toml")) continue;
  const text = read(resolve(tauri, "permissions", file));
  const identifier = text.match(/identifier\s*=\s*"([^"]+)"/)?.[1];
  assert.ok(identifier, `${file} must declare a permission identifier`);
  const allow = text.match(/commands\.allow\s*=\s*\[([\s\S]*?)\]/);
  const names = [...(allow?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  permissionCommands.set(identifier, new Set(names));
}

// --- 3. Window capabilities -------------------------------------------------

const windowPermissions = new Map<string, Set<string>>();
for (const file of readdirSync(resolve(tauri, "capabilities"))) {
  if (!file.endsWith(".json")) continue;
  const capability = JSON.parse(read(resolve(tauri, "capabilities", file)));
  for (const windowLabel of capability.windows ?? []) {
    const permissionsForWindow = windowPermissions.get(windowLabel) ?? new Set<string>();
    for (const permission of capability.permissions ?? []) permissionsForWindow.add(permission);
    windowPermissions.set(windowLabel, permissionsForWindow);
  }
}

const grantedFor = (windowLabel: string) => {
  const granted = new Set<string>();
  for (const permission of windowPermissions.get(windowLabel) ?? []) {
    for (const command of permissionCommands.get(permission) ?? []) granted.add(command);
  }
  return granted;
};

const windows = [...windowPermissions.keys()].sort();
assert.deepEqual(windows, ["avatar", "debug", "main"], `unexpected capability windows: ${windows.join(", ")}`);

// --- 4. Frontend invokes and their reachable windows ------------------------

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

const files = walk(source).filter((path) => !/\.test\.(ts|tsx)$/.test(path));

function localImports(path: string): string[] {
  const text = read(path);
  return [...text.matchAll(/from\s+"(\.[^"]+)"/g)]
    .map((match) => {
      const target = resolve(path, "..", match[1]);
      return [target, `${target}.ts`, `${target}.tsx`, resolve(target, "index.ts")].find((candidate) => {
        try {
          return statSync(candidate).isFile();
        } catch {
          return false;
        }
      }) ?? null;
    })
    .filter((candidate): candidate is string => candidate !== null);
}

const entryWindows: Array<[string, string]> = [
  ["App.tsx", "main"],
  ["AvatarApp.tsx", "avatar"],
  ["DebugWindow.tsx", "debug"],
  ["debug.tsx", "debug"],
];

const reachableWindows = new Map<string, Set<string>>();
for (const [entryName, windowLabel] of entryWindows) {
  const entry = resolve(source, entryName);
  const queue = [entry];
  const seen = new Set<string>();
  while (queue.length) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    reachableWindows.set(path, (reachableWindows.get(path) ?? new Set<string>()).add(windowLabel));
    queue.push(...localImports(path));
  }
}

const invoked = new Map<string, Set<string>>();
const dynamic = new Set<string>();
for (const path of files) {
  const text = read(path);
  for (const match of text.matchAll(/\binvoke(?:<[^>]*>)?\(\s*("([^"]+)"|[A-Za-z_$][\w$]*)/g)) {
    if (match[2]) {
      const command = match[2];
      invoked.set(command, (invoked.get(command) ?? new Set<string>()).add(path));
    } else {
      dynamic.add(`${path}: ${match[1]}`);
    }
  }
}
assert.equal(dynamic.size, 0, `invoke() calls must use a literal command name so the ACL can be audited:\n- ${[...dynamic].join("\n- ")}`);
assert.ok(invoked.size >= 8, `expected at least 8 invoked commands, found ${invoked.size}`);

// --- 5. Assertions ----------------------------------------------------------

const relative = (path: string) => path.slice(source.length + 1);

const unregistered = [...invoked.keys()].filter((command) => !registered.has(command));
assert.deepEqual(unregistered, [], `frontend invokes commands that are not registered in lib.rs: ${unregistered.join(", ")}`);

const strayGrants = [...permissionCommands].flatMap(([identifier, commands]) =>
  [...commands].filter((command) => !registered.has(command)).map((command) => `${identifier}: ${command}`),
);
assert.deepEqual(strayGrants, [], `permission files grant commands that are not registered in lib.rs:\n- ${strayGrants.join("\n- ")}`);

const ungranted: string[] = [];
for (const [command, callers] of invoked) {
  for (const caller of callers) {
    for (const windowLabel of reachableWindows.get(caller) ?? []) {
      if (!grantedFor(windowLabel).has(command)) {
        ungranted.push(`${windowLabel} window: ${command} (invoked from ${relative(caller)})`);
      }
    }
  }
}
assert.deepEqual(ungranted.sort(), [], `frontend invokes commands its window capability does not grant:\n- ${ungranted.sort().join("\n- ")}`);

// A registered command that no window can reach is dead weight, but it may be
// planned for a future surface. Only assert the audit itself stayed complete.
assert.ok(registered.size >= invoked.size, "every invoked command should also be registered");

console.log(`ACL guard passed: ${registered.size} registered commands, ${invoked.size} invoked, windows ${windows.join("/")}.`);
