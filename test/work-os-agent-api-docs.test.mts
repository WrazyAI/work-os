import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import yaml from "js-yaml";
import {
  AGENT_API_AGENT_PROMPT,
  AGENT_API_BASE_URL,
  AGENT_API_CURL_SAMPLE,
  AGENT_API_ENDPOINTS,
  AGENT_API_ERRORS,
  AGENT_API_EVIDENCE_MAX_BYTES,
  AGENT_API_EVIDENCE_TYPE_LABELS,
  AGENT_API_GUIDE_URL,
  AGENT_API_LLMS_URL,
  AGENT_API_MCP_TOOLS,
  AGENT_API_RATE_LIMIT_REQUESTS,
  AGENT_API_RATE_LIMIT_WRITES,
  AGENT_API_SCOPES,
  AGENT_API_TYPESCRIPT_SAMPLE,
} from "../src/modules/work-os/agent-api-docs.ts";
import { COMPLETION_EVIDENCE_ALLOWED_TYPES, COMPLETION_EVIDENCE_MAX_BYTES } from "../src/modules/work-os/completion-evidence.ts";
import { AGENT_RATE_LIMIT_MAX_REQUESTS, AGENT_RATE_LIMIT_MAX_WRITES } from "../src/lib/work-agent-rate-limit.ts";
import { highlightCode } from "../src/modules/work-os/code-highlight.ts";
import { buildAgentInstructions } from "../src/modules/work-os/agent-api-llms.ts";

const root = new URL("../", import.meta.url);
const read = (file: string) => readFile(new URL(file, root), "utf8");
const optional = (file: string) => read(file).catch(() => null);
const HTTP_METHODS = new Set(["get", "post", "patch", "delete"]);

type SpecOperation = {
  "x-required-scope"?: string;
  "x-required-scope-any"?: string[];
  security?: unknown[];
};

async function openapi(file = "work-os-agent-v1.yaml") {
  return yaml.load(await read(`docs/openapi/${file}`)) as {
    servers: { url: string }[];
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
  assert.match(component, /id="agent-setup"/);
  assert.match(component, /Want your agent to set it up for you\?/);
  assert.match(component, /href=\{AGENT_API_LLMS_URL\}/);
  const route = await read("src/app/docs/agent-api/user/page.tsx");
  assert.match(route, /<ApiDocs/);
  assert.match(route, /<GuideSwitch current="user"/);
  const layout = await read("src/app/docs/agent-api/layout.tsx");
  assert.match(layout, /data-work-os-workspace/);
  assert.match(layout, /auth\.api\.getSession/);
  assert.match(layout, /signedIn \? "Dashboard" : "Sign in"/);
});

test("Settings and the token panel both lead to the guide", async () => {
  const settings = await read("src/modules/work-os/employee/EmployeeSettings.tsx");
  const tokenPanel = await read("src/modules/work-os/employee/AgentAccessSettings.tsx");
  assert.match(settings, /href=(?:"\/docs\/agent-api(?:\/user)?"|\{AGENT_API_GUIDE_URL\})/);
  assert.match(settings, /Open API guide/);
  assert.match(tokenPanel, /href=(?:"\/docs\/agent-api(?:\/user)?"|\{AGENT_API_GUIDE_URL\})/);
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

test("the agent instructions carry the full public contract", () => {
  const text = buildAgentInstructions();
  assert.ok(text.startsWith("# Work OS Agent API v1"));
  assert.ok(text.includes(AGENT_API_BASE_URL));
  assert.ok(text.includes(AGENT_API_AGENT_PROMPT));
  for (const endpoint of AGENT_API_ENDPOINTS) {
    assert.ok(text.includes(`\`${endpoint.path}\``), `missing ${endpoint.path}`);
    assert.ok(text.includes(endpoint.method), `missing ${endpoint.method} ${endpoint.path}`);
  }
  for (const scope of AGENT_API_SCOPES) assert.ok(text.includes(`\`${scope.id}\``));
  for (const error of AGENT_API_ERRORS) assert.ok(text.includes(`\`${error.code}\``));
  for (const tool of AGENT_API_MCP_TOOLS) assert.ok(text.includes(`\`${tool.name}\``));
  assert.ok(text.includes("Idempotency-Key"));
  assert.ok(text.includes("evidence_required"));
});

test("the chooser is indexable and links to both canonical guides", async () => {
  const chooser = await read("src/app/docs/agent-api/page.tsx");
  assert.match(chooser, /robots: \{ index: true, follow: true \}/);
  assert.match(chooser, /Employee guide/);
  assert.match(chooser, /Administrator guide/);
  assert.match(chooser, /href=\{AGENT_API_GUIDE_PATH\}/);
  assert.match(chooser, /href=\{ADMIN_AGENT_API_GUIDE_PATH\}/);
  assert.doesNotMatch(chooser, /<ApiDocs/);
  assert.equal(AGENT_API_GUIDE_URL, "https://app.wrazyos.com/docs/agent-api/user");
  assert.equal(AGENT_API_LLMS_URL, "https://app.wrazyos.com/docs/agent-api/user/llms.txt");
});

test("the published llms.txt alias uses a permanent host-relative redirect", async () => {
  const { GET } = await import("../src/app/docs/agent-api/llms.txt/route.ts");
  const response = GET();
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "/docs/agent-api/user/llms.txt");
});

test("each guide's llms.txt serves its contract as cacheable public text", async () => {
  const { GET: user } = await import("../src/app/docs/agent-api/user/llms.txt/route.ts");
  const { GET: admin } = await import("../src/app/docs/agent-api/admin/llms.txt/route.ts");
  for (const [get, base] of [
    [user, "https://app.wrazyos.com/api/agent/v1"],
    [admin, "https://app.wrazyos.com/api/agent/admin/v1"],
  ] as const) {
    const response = await get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "public, max-age=300");
    assert.ok((await response.text()).includes(base));
  }
  const text = await admin().text();
  assert.match(text, /only POST \/previews\/\{previewId\}\/confirm applies it, exactly once/i);
  assert.match(text, /admin_agent_api/);
  assert.match(text, /Employee tokens are rejected with 401/);
  assert.match(text, /Idempotency-Key.*24 hours.*Idempotent-Replay: true/);
  assert.match(text, /\/api\/agent\/admin\/mcp/);
  assert.match(text, /`confirm_action`/);
});

test("the administrator page has a separate guide and an employee route switch", async () => {
  const route = await read("src/app/docs/agent-api/admin/page.tsx");
  assert.match(route, /<AdminApiDocs/);
  assert.match(route, /<GuideSwitch current="admin"/);
  const component = await read("src/modules/work-os/admin-agent-docs/AdminApiDocs.tsx");
  for (const model of ["ENDPOINTS", "SCOPES", "ERRORS", "MCP_TOOLS", "RULES"]) {
    assert.match(component, new RegExp(`ADMIN_AGENT_API_${model}[.]`));
  }
  assert.match(component, /Get a token/);
  // The settings entry must select the administrator view before redirecting:
  // a saved "My workspace" preference otherwise sends this link to /work-os/today.
  assert.match(component, /<WorkOsViewModeForm[\s\S]*?mode="admin"[\s\S]*?next="\/work-os\/admin\/settings"/);
  assert.doesNotMatch(component, /href="\/work-os\/admin\/settings"/);
});

test("admin docs match the OpenAPI base, method/path/scope map, and vocabulary", async () => {
  const spec = await openapi("work-os-admin-agent-v1.yaml");
  const urls = await import("../src/modules/work-os/agent-api-docs.ts");
  const docs = await import("../src/modules/work-os/admin-agent-api-docs.ts");
  assert.equal(urls.ADMIN_AGENT_API_BASE_URL, spec.servers[0].url);
  assert.equal(urls.ADMIN_AGENT_API_OPENAPI_URL, `${spec.servers[0].url}/openapi.yaml`);
  assert.equal(urls.ADMIN_AGENT_API_MCP_URL, "https://app.wrazyos.com/api/agent/admin/mcp");
  assert.equal(urls.ADMIN_AGENT_API_TOKEN_PREFIX, "wos_admin_");
  assert.equal(urls.ADMIN_AGENT_API_GUIDE_URL, "https://app.wrazyos.com/docs/agent-api/admin");
  assert.equal(urls.ADMIN_AGENT_API_LLMS_URL, "https://app.wrazyos.com/docs/agent-api/admin/llms.txt");
  assert.ok(urls.ADMIN_AGENT_API_AGENT_PROMPT.includes(urls.ADMIN_AGENT_API_LLMS_URL));
  const endpoints = docs.ADMIN_AGENT_API_ENDPOINTS
    .map(({ method, path, requiredScope }) => ({ method, path, requiredScope }))
    .sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
  assert.deepEqual(endpoints, specEndpoints(spec));
  for (const endpoint of docs.ADMIN_AGENT_API_ENDPOINTS) {
    const operation = spec.paths[endpoint.path][endpoint.method.toLowerCase()];
    assert.deepEqual(endpoint.requiredScopeAny, operation["x-required-scope-any"]);
  }
  assert.deepEqual(docs.ADMIN_AGENT_API_SCOPES.map(({ id }) => id).sort(), [...spec.components.schemas.Scope.enum].sort());
  assert.deepEqual(docs.ADMIN_AGENT_API_ERRORS.map(({ code }) => code).sort(), [...spec.components.schemas.Error.properties.code.enum].sort());
});

test("admin docs list the live MCP tools and their direct or per-action scope", async () => {
  const source = await read("src/lib/work-admin-agent-mcp.ts");
  const { ADMIN_AGENT_API_MCP_TOOLS } = await import("../src/modules/work-os/admin-agent-api-docs.ts");
  const tools = [...source.matchAll(/server\.registerTool\("([^"]+)",([\s\S]*?)(?=server\.registerTool|return server;)/g)];
  assert.deepEqual(ADMIN_AGENT_API_MCP_TOOLS.map(({ name }) => name), tools.map(([, name]) => name));
  for (const [, name, body] of tools) {
    const scope = body.match(/runTool\(agent, "([^"]+)"/)?.[1];
    if (!scope) assert.match(body, /adminPreviewActionScope|confirmAction/);
    assert.equal(ADMIN_AGENT_API_MCP_TOOLS.find((tool) => tool.name === name)?.scope, scope ?? "Action write scope");
  }
});
