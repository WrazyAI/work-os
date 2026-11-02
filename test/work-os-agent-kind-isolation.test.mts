import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the employee resolver only accepts employee tokens", async () => {
  const auth = await read("src/lib/work-agent-auth.ts");
  assert.match(auth, /\.eq\("kind", "employee"\)/);
});

test("the admin MCP route is excluded from proxy body buffering", async () => {
  const proxy = await read("src/proxy.ts");
  assert.match(proxy, /api\/agent\/admin\/mcp/);
});

test("the employee MCP still exposes exactly seven tools", async () => {
  const mcp = await read("src/lib/work-agent-mcp.ts");
  const block = mcp.match(/AGENT_MCP_TOOL_NAMES = \[([^\]]+)\]/)?.[1] ?? "";
  assert.equal((block.match(/"[a-z_]+"/g) ?? []).length, 7);
});
