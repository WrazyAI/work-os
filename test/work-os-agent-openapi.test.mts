import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import yaml from "js-yaml";

const root = new URL("../", import.meta.url);
const read = (file: string) => readFile(new URL(file, root), "utf8");

const DESIGN_CODES = [
  "unauthorized",
  "token_revoked",
  "token_expired",
  "insufficient_scope",
  "not_found",
  "validation_error",
  "evidence_required",
  "idempotency_conflict",
  "idempotency_in_flight",
  "rate_limited",
  "file_too_large",
  "unsupported_file_type",
];

async function routePaths(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      paths.push(...await routePaths(path.join(dir, entry.name), `${prefix}/${entry.name}`));
    } else if (entry.name === "route.ts") {
      paths.push(prefix || "/");
    }
  }
  return paths;
}

test("the OpenAPI document covers every v1 route in both directions", async () => {
  const spec = yaml.load(await read("docs/openapi/work-os-agent-v1.yaml")) as Record<string, any>;
  const directory = fileURLToPath(new URL("../src/app/api/agent/v1", import.meta.url));
  const actual = (await routePaths(directory)).map((route) => route.replace(/\[([^\]]+)\]/g, "{$1}")).sort();
  const documented = Object.keys(spec.paths as Record<string, unknown>).sort();
  assert.deepEqual(documented, actual);
  for (const [route, item] of Object.entries(spec.paths as Record<string, Record<string, any>>)) {
    for (const [method, operation] of Object.entries(item)) {
      if (route === "/openapi.yaml") {
        assert.deepEqual(operation.security, [], "the schema itself is public");
        continue;
      }
      assert.deepEqual(operation.security ?? spec.security, [{ bearerAuth: [] }], `${method} ${route} must require the bearer scheme`);
      assert.ok(
        ["none", "tasks:read", "tasks:write", "progress:write", "evidence:write"].includes(operation["x-required-scope"]),
        `${method} ${route} needs a known scope`,
      );
    }
  }
});

test("the error enum carries every design code", async () => {
  const spec = yaml.load(await read("docs/openapi/work-os-agent-v1.yaml")) as Record<string, any>;
  const codes = spec.components.schemas.Error.properties.code.enum as string[];
  for (const code of DESIGN_CODES) assert.ok(codes.includes(code), `missing ${code}`);
});

test("the served schema reads the repository contract", async () => {
  const route = await read("src/app/api/agent/v1/openapi.yaml/route.ts");
  assert.match(route, /docs\/openapi\/work-os-agent-v1\.yaml/);
  assert.match(route, /application\/yaml/);
});

test("the proxy lets agent bearers and the public schema reach their routes", async () => {
  const proxy = await read("src/proxy.ts");
  assert.match(proxy, /"\/api\/agent\/v1\/openapi\.yaml"/, "the schema is public");
  assert.match(proxy, /pathname\.startsWith\("\/api\/agent\/"\)/, "agent bearer requests pass the cookie gate");
  assert.match(proxy, /agentBearer/);
});
