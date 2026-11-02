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
  // Slice the matcher block, not the whole file: a comment alone must not
  // satisfy this test. The close anchor is the indented `],` line so character
  // classes inside the matcher string (e.g. `[^/]+`) cannot end the slice.
  const matcher = proxy.match(/matcher: \[([\s\S]+?)\n  \],/)?.[1] ?? "";
  assert.ok(matcher, "the proxy matcher block is missing");
  assert.match(matcher, /api\/mcp\|api\/agent\/admin\/mcp/);
});

test("the employee MCP still exposes exactly seven tools", async () => {
  const mcp = await read("src/lib/work-agent-mcp.ts");
  const block = mcp.match(/AGENT_MCP_TOOL_NAMES = \[([^\]]+)\]/)?.[1] ?? "";
  assert.equal((block.match(/"[a-z_]+"/g) ?? []).length, 7);
});
