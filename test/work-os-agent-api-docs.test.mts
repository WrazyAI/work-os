import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import yaml from "js-yaml";
import {
  AGENT_API_CURL_SAMPLE,
  AGENT_API_ENDPOINTS,
  AGENT_API_ERRORS,
  AGENT_API_EVIDENCE_MAX_BYTES,
  AGENT_API_EVIDENCE_TYPE_LABELS,
  AGENT_API_MCP_TOOLS,
  AGENT_API_RATE_LIMIT_REQUESTS,
  AGENT_API_RATE_LIMIT_WRITES,
  AGENT_API_SCOPES,
  AGENT_API_TYPESCRIPT_SAMPLE,
} from "../src/modules/work-os/agent-api-docs.ts";
import { COMPLETION_EVIDENCE_ALLOWED_TYPES, COMPLETION_EVIDENCE_MAX_BYTES } from "../src/modules/work-os/completion-evidence.ts";
import { AGENT_RATE_LIMIT_MAX_REQUESTS, AGENT_RATE_LIMIT_MAX_WRITES } from "../src/lib/work-agent-rate-limit.ts";
import { highlightCode } from "../src/modules/work-os/code-highlight.ts";

const root = new URL("../", import.meta.url);
const read = (file: string) => readFile(new URL(file, root), "utf8");
const optional = (file: string) => read(file).catch(() => null);
const HTTP_METHODS = new Set(["get", "post", "patch", "delete"]);

type SpecOperation = {
  "x-required-scope"?: string;
  security?: unknown[];
};

async function openapi() {
  return yaml.load(await read("docs/openapi/work-os-agent-v1.yaml")) as {
    paths: Record<string, Record<string, SpecOperation>>;
    components: {
      schemas: {
        Scope: { enum: string[] };
        Error: { properties: { code: { enum: string[] } } };
      };
    };
  };
}

function specEndpoints(spec: Awaited<ReturnType<typeof openapi>>) {
  return Object.entries(spec.paths).flatMap(([path, operations]) => (
    Object.entries(operations)
      .filter(([method]) => HTTP_METHODS.has(method))
      .map(([method, operation]) => ({
        method: method.toUpperCase(),
        path,
        requiredScope: operation["x-required-scope"] ?? "public",
      }))
  )).sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`));
}

test("the documented endpoint set exactly matches the OpenAPI contract", async () => {
  const documented = specEndpoints(await openapi());
  const page = AGENT_API_ENDPOINTS.map(({ method, path, requiredScope }) => ({ method, path, requiredScope }))
    .sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`));
  assert.deepEqual(page, documented);
});

test("the page's scope vocabulary matches the OpenAPI scope enum", async () => {
  const spec = await openapi();
  assert.deepEqual(AGENT_API_SCOPES.map((scope) => scope.id).sort(), [...spec.components.schemas.Scope.enum].sort());
});

test("the page carries every OpenAPI error code and no invented code", async () => {
  const spec = await openapi();
  assert.deepEqual(AGENT_API_ERRORS.map((error) => error.code).sort(), [...spec.components.schemas.Error.properties.code.enum].sort());
});

test("batch documents the route's per-operation scope behavior", () => {
  const batch = AGENT_API_ENDPOINTS.find((endpoint) => endpoint.method === "POST" && endpoint.path === "/batch");
  assert.ok(batch);
  assert.equal(batch.scopeLabel, "Per operation");
  assert.match(batch.note ?? "", /progress:write/);
});

test("limits and evidence guidance follow the shared runtime constants", () => {
  assert.equal(AGENT_API_RATE_LIMIT_REQUESTS, AGENT_RATE_LIMIT_MAX_REQUESTS);
  assert.equal(AGENT_API_RATE_LIMIT_WRITES, AGENT_RATE_LIMIT_MAX_WRITES);
  assert.equal(AGENT_API_EVIDENCE_MAX_BYTES, COMPLETION_EVIDENCE_MAX_BYTES);
  assert.equal(AGENT_API_EVIDENCE_TYPE_LABELS.length, COMPLETION_EVIDENCE_ALLOWED_TYPES.length);
  assert.equal(new Set(AGENT_API_EVIDENCE_TYPE_LABELS).size, AGENT_API_EVIDENCE_TYPE_LABELS.length);
});

test("MCP lists the seven live tool names once", () => {
  const names = AGENT_API_MCP_TOOLS.map((tool) => tool.name);
  assert.deepEqual(names, ["list_tasks", "get_task", "create_task", "update_task", "complete_task", "log_progress", "attach_evidence"]);
  assert.equal(new Set(names).size, 7);
});

test("the copyable first-call examples use the documented base and bearer header", () => {
  assert.match(AGENT_API_CURL_SAMPLE, /https:\/\/app\.wrazyos\.com\/api\/agent\/v1\/me/);
  assert.match(AGENT_API_CURL_SAMPLE, /Authorization: Bearer \$WORK_OS_API_TOKEN/);
  assert.match(AGENT_API_TYPESCRIPT_SAMPLE, /https:\/\/app\.wrazyos\.com\/api\/agent\/v1/);
  assert.match(AGENT_API_TYPESCRIPT_SAMPLE, /Authorization: `Bearer \$\{token\}`/);
  assert.match(AGENT_API_TYPESCRIPT_SAMPLE, /async function main\(\)/);
  assert.match(AGENT_API_TYPESCRIPT_SAMPLE, /void main\(\);/);
});

test("the rendered guide consumes the contract-backed documentation model", async () => {
  const component = await read("src/modules/work-os/employee/ApiDocs.tsx");
  assert.match(component, /AGENT_API_ENDPOINTS\.filter/);
  assert.match(component, /<EndpointRow/);
  assert.match(component, /AGENT_API_SCOPES\.map/);
  assert.match(component, /AGENT_API_ERRORS\.map/);
  assert.match(component, /AGENT_API_MCP_TOOLS\.map/);
  assert.match(component, /href="\/work-os\/agent-access"/);
  const route = await read("src/app/docs/agent-api/page.tsx");
  assert.match(route, /data-work-os-workspace/);
  assert.match(route, /ApiDocs/);
  assert.match(route, /title: "Agent API"/);
  assert.match(route, /\/docs\/agent-api/);
});

test("Settings and the token panel both lead to the guide", async () => {
  const settings = await read("src/modules/work-os/employee/EmployeeSettings.tsx");
  const tokenPanel = await read("src/modules/work-os/employee/AgentAccessSettings.tsx");
  assert.match(settings, /href="\/docs\/agent-api"/);
  assert.match(settings, /Open API guide/);
  assert.match(tokenPanel, /href="\/docs\/agent-api"/);
  assert.match(tokenPanel, /API guide/);
  assert.match(tokenPanel, /id="agent-access"/);
});

test("the token action enters Settings through a view-safe route", async () => {
  const route = await read("src/app/work-os/agent-access/route.ts");
  assert.match(route, /WORK_OS_VIEW_COOKIE/);
  assert.match(route, /value: "employee"/);
  assert.match(route, /\/work-os\/settings#agent-access/);
  assert.match(route, /auth\.response\.status === 401/);
  assert.match(route, /\/login\?redirect=/);
  const login = await read("src/app/login/page.tsx");
  assert.match(login, /URLSearchParams\(window\.location\.search\)\.get\("redirect"\)/);
});

test("code samples are syntax highlighted with language-specific tokens", () => {
  const typescript = highlightCode(AGENT_API_TYPESCRIPT_SAMPLE, "typescript");
  assert.match(typescript, /hljs-keyword/);
  assert.match(typescript, /hljs-string/);
  assert.match(typescript, /hljs-title/);
  const bash = highlightCode(AGENT_API_CURL_SAMPLE, "bash");
  assert.match(bash, /hljs-string/);
  assert.match(bash, /hljs-variable/);
  const json = highlightCode('{ "error": "Task not found", "code": "not_found" }', "json");
  assert.match(json, /hljs-attr/);
  assert.match(json, /hljs-string/);
});

test("the guide is public and exempt from host chrome", async () => {
  const proxy = await read("src/proxy.ts");
  assert.match(proxy, /"\/docs"/);
  const dashboard = await optional("src/lib/dashboard-access.ts");
  if (dashboard) assert.match(dashboard, /"\/docs"/);
  const shell = await optional("src/components/Shell.tsx");
  if (shell) assert.match(shell, /"\/docs"/);
  const tour = await optional("src/components/GlobalTour.tsx");
  if (tour) assert.match(tour, /pathname === "\/docs"|pathname\.startsWith\("\/docs\/"\)/);
  const activity = await optional("src/lib/activityCenter.ts");
  if (activity) assert.match(activity, /\/docs/);
});
