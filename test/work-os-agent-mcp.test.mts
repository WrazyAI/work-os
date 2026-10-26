import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AgentAccess } from "../src/lib/work-agent-auth";
import {
  AGENT_MCP_TOOL_NAMES,
  agentMcpIdempotencyKey,
  createAgentMcpServer,
  decodeEvidenceBase64,
  type AgentMcpServices,
} from "../src/lib/work-agent-mcp";
import type { AgentScope } from "../src/lib/work-agent-tokens";
import type { WorkOsAccess } from "../src/lib/work-os-api";

const png = Buffer.from("89504e470d0a1a0a", "hex");

function agentWith(scopes: AgentScope[]): AgentAccess {
  return {
    access: {} as WorkOsAccess,
    tokenId: `test-${randomUUID()}`,
    tokenName: "MCP test",
    tokenPrefix: "wos_agent_test",
    expiresAt: null,
    scopes,
  };
}

function fakeServices() {
  const calls = {
    createKeys: [] as string[],
    attachKeys: [] as string[],
    attachBytes: [] as number[],
  };
  const services: AgentMcpServices = {
    listTasks: async () => ({ tasks: [], nextCursor: null }),
    getTask: async () => ({ task: { id: "task-1" } }),
    createTask: async (_agent, _body, key) => {
      calls.createKeys.push(key);
      return { id: "task-1", title: "Ship" };
    },
    updateTask: async () => ({ id: "task-1" }),
    completeTask: async () => ({ task: { id: "task-1", completed: true } }),
    addProgress: async () => ({ id: "evidence-1" }),
    attachEvidence: async (_agent, _taskId, input, key) => {
      calls.attachKeys.push(key);
      calls.attachBytes.push(input.bytes.byteLength);
      return { evidence: { id: "evidence-1" } };
    },
  };
  return { calls, services };
}

async function connectTestMcp(agent: AgentAccess) {
  const { calls, services } = fakeServices();
  const server = createAgentMcpServer(agent, services);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "work-os-mcp-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    calls,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const block = content?.find((item) => item.type === "text");
  return typeof block?.text === "string" ? block.text : "";
}

test("the MCP registry exposes exactly the seven design tools", async () => {
  const { client, close } = await connectTestMcp(agentWith(["tasks:read", "tasks:write", "progress:write", "evidence:write"]));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), [...AGENT_MCP_TOOL_NAMES]);
  assert.deepEqual([...AGENT_MCP_TOOL_NAMES], [
    "list_tasks",
    "get_task",
    "create_task",
    "update_task",
    "complete_task",
    "log_progress",
    "attach_evidence",
  ]);
  await close();
});

test("identical create arguments reuse the derived idempotency key", async () => {
  assert.equal(agentMcpIdempotencyKey("create_task", { name: "Ship" }), agentMcpIdempotencyKey("create_task", { name: "Ship" }));
  assert.notEqual(agentMcpIdempotencyKey("create_task", { name: "Ship" }), agentMcpIdempotencyKey("create_task", { name: "Ship 2" }));
  assert.ok(agentMcpIdempotencyKey("create_task", { name: "Ship" }).length <= 160);
});

test("create_task passes one derived key for identical arguments", async () => {
  const { client, calls, close } = await connectTestMcp(agentWith(["tasks:write"]));
  const argumentsValue = { name: "Ship", due_date: "2026-10-30" };
  await client.callTool({ name: "create_task", arguments: argumentsValue });
  await client.callTool({ name: "create_task", arguments: argumentsValue });
  assert.equal(calls.createKeys.length, 2);
  assert.equal(calls.createKeys[0], calls.createKeys[1]);
  assert.match(calls.createKeys[0]!, /^mcp:create_task:[0-9a-f]{64}$/);
  await close();
});

test("a read-only token gets a scope error, not a transport failure", async () => {
  const { client, close } = await connectTestMcp(agentWith(["tasks:read"]));
  const result = await client.callTool({ name: "create_task", arguments: { name: "Blocked" } });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /insufficient_scope/);
  await close();
});

test("attach_evidence forwards decoded bytes and a stable key", async () => {
  const { client, calls, close } = await connectTestMcp(agentWith(["evidence:write"]));
  const result = await client.callTool({
    name: "attach_evidence",
    arguments: {
      task_id: "task-1",
      file_name: "screen.png",
      content_type: "image/png",
      content_base64: png.toString("base64"),
    },
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls.attachBytes, [png.length]);
  assert.match(calls.attachKeys[0]!, /^mcp:attach_evidence:[0-9a-f]{64}$/);
  await close();
});

test("evidence base64 is decoded and bounded before the service sees it", () => {
  assert.deepEqual(decodeEvidenceBase64(png.toString("base64")), new Uint8Array(png));
  assert.throws(() => decodeEvidenceBase64(""), /required/i);
  assert.throws(() => decodeEvidenceBase64("!!!!"), /base64/i);
  assert.throws(
    () => decodeEvidenceBase64(Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64")),
    /8 MB|smaller|large/i,
  );
});

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the MCP route authenticates the bearer and uses the stateless web transport", async () => {
  const route = await read("src/app/api/mcp/route.ts");
  assert.match(route, /requireAgentAccess\(request\)/);
  assert.match(route, /WebStandardStreamableHTTPServerTransport/);
  assert.match(route, /sessionIdGenerator: undefined/);
  assert.match(route, /enableJsonResponse: true/);
  assert.match(route, /export async function POST/);
  assert.match(route, /405/);
});

test("the proxy leaves the MCP body unbuffered", async () => {
  const proxy = await read("src/proxy.ts");
  assert.match(proxy, /api\/mcp/);
  assert.match(proxy, /api\/downloads/);
});
