import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ADMIN_AGENT_MCP_TOOL_NAMES,
  adminPreviewIdempotencyKey,
  createAdminAgentMcpServer,
  createAdminAgentMcpServices,
  type AdminAgentMcpIdempotency,
  type AdminAgentMcpServices,
} from "../src/lib/work-admin-agent-mcp";
import type { AdminAgentAccess } from "../src/lib/work-admin-agent-auth";
import type { AdminAgentActionServices } from "../src/lib/work-admin-agent-actions";
import {
  ADMIN_PREVIEW_TTL_MS,
  type AdminPreviewConfirmDeps,
  type AdminPreviewConfirmResult,
  type AdminPreviewRecord,
  type CreateAdminPreviewInput,
} from "../src/lib/work-admin-action-previews";
import type { AdminAgentScope } from "../src/lib/work-agent-tokens";
import { AGENT_MCP_TOOL_NAMES } from "../src/lib/work-agent-mcp";
import { AGENT_RATE_LIMIT_MAX_WRITES } from "../src/lib/work-agent-rate-limit";
import type { Json } from "../src/lib/work-os-internal";
import type { WorkOsAccess } from "../src/lib/work-os-api";
import type { AdminPreview } from "../src/modules/work-os/admin-agent/contracts";

const png = Buffer.from("89504e470d0a1a0a", "hex");

function adminWith(scopes: AdminAgentScope[]): AdminAgentAccess {
  return {
    // The preview record needs the organization and user the row is owned by;
    // no reader is reached in these tests.
    access: {
      organizationId: "org-1",
      ctx: { user: { id: "user-1" } },
    } as unknown as WorkOsAccess,
    tokenId: `test-${randomUUID()}`,
    tokenName: "Admin MCP test",
    tokenPrefix: "wos_admin_test",
    expiresAt: null,
    scopes,
    reviewerPersonId: "admin-person",
  };
}

const ALL_SCOPES: AdminAgentScope[] = [
  "people:read",
  "tasks:read",
  "tasks:write",
  "eods:read",
  "eods:review",
  "records:read",
  "insights:read",
];

function fakeServices() {
  const calls = {
    preview: [] as Array<{ action: string; payload: Json; key: string | null }>,
    confirm: [] as Array<{ previewId: string; key: string }>,
    progress: [] as Array<{ taskId: string; body: Json; key: string }>,
    evidence: [] as Array<{ taskId: string; bytes: number; key: string; note: string }>,
    people: [] as unknown[],
    person: [] as string[],
    tasks: [] as Json[],
    task: [] as string[],
    eods: [] as Json[],
    eod: [] as string[],
    records: [] as Json[],
    overview: [] as Json[],
    insights: [] as Json[],
  };
  const services: AdminAgentMcpServices = {
    searchPeople: async (_agent, input) => {
      calls.people.push(input);
      return { people: [{ id: "p1" }], total: 1, cursor: { next: null } };
    },
    getPerson: async (_agent, personId) => {
      calls.person.push(personId);
      return personId === "missing" ? null : { person: { id: personId } };
    },
    listTasks: async (_agent, input) => {
      calls.tasks.push(input);
      return { tasks: [{ id: "t1" }], total: 1, cursor: { next: null } };
    },
    getTask: async (_agent, taskId) => {
      calls.task.push(taskId);
      return { task: { id: taskId }, subtasks: [], completionEvidence: [] };
    },
    listEods: async (_agent, input) => {
      calls.eods.push(input);
      return { eods: [{ id: "e1" }], counts: { total: 1 }, total: 1, cursor: { next: null } };
    },
    getEod: async (_agent, reportId) => {
      calls.eod.push(reportId);
      return reportId === "missing" ? null : { eod: { id: reportId }, versions: [] };
    },
    listRecords: async (_agent, input) => {
      calls.records.push(input);
      return { records: [{ id: "r1" }], total: 1, cursor: { next: null }, coverage: [] };
    },
    getOverview: async (_agent, input) => {
      calls.overview.push(input);
      return { date: "2026-11-02" };
    },
    getInsights: async (_agent, input) => {
      calls.insights.push(input);
      return { range: "7d" };
    },
    previewAction: async (_agent, action, payload, idempotencyKey) => {
      calls.preview.push({ action, payload, key: idempotencyKey ?? null });
      return {
        id: "preview-1",
        action,
        summary: "Assign Ship",
        changes: [{ field: "assignees", from: [], to: ["p1"] }],
        warnings: [],
        state: {},
        expiresAt: "2026-11-02T00:15:00.000Z",
      };
    },
    confirmAction: async (_agent, previewId, idempotencyKey) => {
      calls.confirm.push({ previewId, key: idempotencyKey });
      return { status: 200, replayed: false, result: { task: { id: "t1" } } };
    },
    logProgress: async (_agent, taskId, body, key) => {
      calls.progress.push({ taskId, body, key });
      return { id: "evidence-1", title: "Progress note", summary: "A note", source: "agent", createdAt: "2026-11-02T00:00:00Z" };
    },
    attachEvidence: async (_agent, taskId, input, key) => {
      calls.evidence.push({ taskId, bytes: input.bytes.byteLength, key, note: input.note });
      return { evidence: { id: "evidence-1" } };
    },
  };
  return { calls, services };
}

function fakeIdempotency() {
  const keys: string[] = [];
  const idempotency = (async (input: {
    key: string;
    handler: () => Promise<{ status: number; body: unknown }>;
  }) => {
    keys.push(input.key);
    return { ...(await input.handler()), replayed: false };
  }) as AdminAgentMcpIdempotency;
  return { keys, idempotency };
}

async function connect(
  services: AdminAgentMcpServices,
  scopes: AdminAgentScope[] = ALL_SCOPES,
) {
  const agent = adminWith(scopes);
  const { keys, idempotency } = fakeIdempotency();
  const server = createAdminAgentMcpServer(agent, services, idempotency);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "work-os-admin-mcp-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return {
    agent,
    client,
    keys,
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

function bodyOf(result: unknown): Json {
  return JSON.parse(textOf(result)) as Json;
}

/** An error shaped like the preview store's `WorkAdminPreviewError`. The admin
 * mapper matches it by class name, so a fake store can model expiry without a
 * database. */
function previewStoreError(code: string, status: number): Error {
  const error = new Error(code);
  error.name = "WorkAdminPreviewError";
  return Object.assign(error, { code, status });
}

type StoredPreview = {
  card: AdminPreview;
  request: Json;
  targetType: string;
  targetId: string | null;
  result: { status: number; body: Json } | null;
};

/** A minimal stand-in for `work_admin_action_previews`: it replays by creation
 * key even when the row has expired (exactly like the real store) and refuses
 * an expired or already-applied confirm the same way. This is what lets the
 * TTL test prove a repeated preview is no longer wedged. */
function previewStore() {
  const byKey = new Map<string, StoredPreview>();
  const byId = new Map<string, StoredPreview>();
  const calls = {
    create: [] as Array<{ key: string; action: string; request: Json }>,
    confirm: [] as Array<{ previewId: string; key: string }>,
    apply: 0,
    reads: 0,
  };
  let sequence = 0;

  const create = async (input: CreateAdminPreviewInput): Promise<AdminPreview> => {
    const key = input.idempotencyKey ?? "";
    calls.create.push({ key, action: input.action, request: input.request });
    const existing = byKey.get(key);
    if (existing) return existing.card;
    const card: AdminPreview = {
      id: `preview-${++sequence}`,
      action: input.action,
      summary: input.preview.summary,
      changes: input.preview.changes,
      warnings: input.preview.warnings,
      state: input.state,
      expiresAt: (input.expiresAt ?? new Date()).toISOString(),
    };
    const stored: StoredPreview = {
      card,
      request: input.request,
      targetType: input.targetType,
      targetId: input.targetId,
      result: null,
    };
    byKey.set(key, stored);
    byId.set(card.id, stored);
    return card;
  };

  const record = async (
    _access: WorkOsAccess,
    previewId: string,
  ): Promise<AdminPreviewRecord | null> => {
    const stored = byId.get(previewId);
    if (!stored) return null;
    return {
      preview: stored.card,
      action: stored.card.action,
      request: stored.request,
      targetType: stored.targetType,
      targetId: stored.targetId,
    };
  };

  const confirm = async (
    _access: WorkOsAccess,
    previewId: string,
    idempotencyKey: string | null,
    deps: AdminPreviewConfirmDeps,
  ): Promise<AdminPreviewConfirmResult> => {
    calls.confirm.push({ previewId, key: idempotencyKey ?? "" });
    const stored = byId.get(previewId);
    if (!stored) throw previewStoreError("preview_not_found", 404);
    // Replay wins over expiry, exactly like the real store.
    if (stored.result) return { ...stored.result, replayed: true };
    if (new Date(stored.card.expiresAt).getTime() <= Date.now()) {
      throw previewStoreError("preview_expired", 410);
    }
    await deps.readState();
    calls.reads += 1;
    const applied = await deps.apply();
    stored.result = { status: applied.status, body: applied.body };
    return { status: applied.status, body: applied.body, replayed: false };
  };

  return { byKey, byId, calls, create, record, confirm };
}

/** The action layer's seven services with every write recorded, so a preview
 * that accidentally applied would be visible as a counter. */
function actionServices(writes: string[]): AdminAgentActionServices {
  const task = {
    id: "task-1",
    title: "Ship",
    status: "active",
    completed: false,
    assignee_person_ids: [],
    updated_at: "2026-11-02T00:00:00.000Z",
  };
  return {
    getTask: async () => ({ ...task }),
    createTask: async () => {
      writes.push("createTask");
      return { task };
    },
    updateTask: async () => {
      writes.push("updateTask");
      return { task };
    },
    moveTask: async () => {
      writes.push("moveTask");
      return { task };
    },
    completeTask: async () => {
      writes.push("completeTask");
      return { task };
    },
    archiveTask: async () => {
      writes.push("archiveTask");
      return { task };
    },
    getEod: async () => null,
    reviewEod: async () => {
      writes.push("reviewEod");
      return {};
    },
    listPeople: async () => [{ id: "p1", displayName: "Ada", active: true }],
  };
}

const ASSIGN_ARGUMENTS = {
  action: "task.assign",
  payload: { task_id: "task-1", mode: "add", person_ids: ["p1"] },
};

test("the admin server exposes exactly the thirteen admin tools", async () => {
  const { calls, services } = fakeServices();
  const { client, close } = await connect(services);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [...ADMIN_AGENT_MCP_TOOL_NAMES].sort());
  assert.equal(tools.length, 13);
  assert.deepEqual([...ADMIN_AGENT_MCP_TOOL_NAMES], [
    "search_people",
    "get_person",
    "list_tasks",
    "get_task",
    "list_eods",
    "get_eod",
    "list_records",
    "get_overview",
    "get_insights",
    "preview_action",
    "confirm_action",
    "log_progress",
    "attach_evidence",
  ]);
  assert.equal(tools.filter((tool) => tool.annotations?.readOnlyHint === true).length, 9);
  assert.equal(calls.preview.length, 0);
  await close();
});

test("preview_action advertises its action enum, payload slot, and key", async () => {
  const { services } = fakeServices();
  const { client, close } = await connect(services);
  try {
    const { tools } = await client.listTools();
    const preview = tools.find((tool) => tool.name === "preview_action");
    assert.ok(preview);
    const schema = preview.inputSchema as {
      properties?: Record<string, { enum?: string[]; type?: string }>;
      required?: string[];
    };
    assert.deepEqual(schema.properties?.action?.enum?.slice().sort(), [
      "eod.review",
      "task.archive",
      "task.assign",
      "task.complete",
      "task.create",
      "task.delete",
      "task.move",
      "task.reopen",
      "task.update",
    ]);
    assert.equal(schema.properties?.payload?.type, "object");
    assert.ok(schema.properties?.idempotency_key, "an explicit creation key is accepted");
    assert.deepEqual((schema.required ?? []).slice().sort(), ["action", "payload"]);
  } finally {
    await close();
  }
});

test("the employee MCP server keeps its seven tools", async () => {
  assert.equal(AGENT_MCP_TOOL_NAMES.length, 7);
  assert.equal(ADMIN_AGENT_MCP_TOOL_NAMES.length, 13);
  assert.ok(ADMIN_AGENT_MCP_TOOL_NAMES.includes("preview_action"));
  assert.ok(!(AGENT_MCP_TOOL_NAMES as readonly string[]).includes("preview_action"));
});

test("a read-only token gets insufficient_scope for preview_action", async () => {
  const { calls, services } = fakeServices();
  const { client, close } = await connect(services, ["people:read"]);
  const result = await client.callTool({
    name: "preview_action",
    arguments: { action: "task.assign", payload: { task_id: "t1", mode: "add", person_ids: ["p1"] } },
  });
  assert.equal(result.isError, true);
  assert.equal(bodyOf(result).code, "insufficient_scope");
  assert.equal(calls.preview.length, 0, "the scope check runs before the preview service");
  await close();
});

test("preview_action requires the scope of its own action", async () => {
  const { calls, services } = fakeServices();
  const eodOnly = await connect(services, ["eods:review"]);
  const taskResult = await eodOnly.client.callTool({
    name: "preview_action",
    arguments: { action: "task.create", payload: { name: "Ship" } },
  });
  assert.equal(taskResult.isError, true);
  assert.equal(bodyOf(taskResult).code, "insufficient_scope");
  await eodOnly.close();

  const taskOnly = await connect(services, ["tasks:write"]);
  const eodResult = await taskOnly.client.callTool({
    name: "preview_action",
    arguments: { action: "eod.review", payload: { report_id: "r1", status: "approved" } },
  });
  assert.equal(eodResult.isError, true);
  assert.equal(bodyOf(eodResult).code, "insufficient_scope");
  await taskOnly.close();
  assert.equal(calls.preview.length, 0);
});

test("preview_action never reaches the apply path; confirm_action applies once then replays", async () => {
  const writes: string[] = [];
  const store = previewStore();
  const services = createAdminAgentMcpServices({
    actions: actionServices(writes),
    applyAction: async () => {
      store.calls.apply += 1;
      return { status: 200, body: { task: { id: "task-1" } } };
    },
    previews: { create: store.create, record: store.record, confirm: store.confirm },
  });
  const { client, close } = await connect(services);
  try {
    const preview = await client.callTool({ name: "preview_action", arguments: ASSIGN_ARGUMENTS });
    assert.equal(preview.isError, undefined);
    // The action layer resolved the change, but nothing was applied: the apply
    // spy and every write service are untouched.
    assert.equal(store.calls.apply, 0, "preview_action must not call applyAdminAction");
    assert.deepEqual(writes, [], "preview_action must not call a write service");
    assert.equal(store.calls.confirm.length, 0);
    assert.equal(store.calls.create.length, 1);
    const card = bodyOf(preview);
    assert.equal(card.id, "preview-1");
    assert.equal(card.action, "task.assign");
    assert.equal(card.summary, "Assign Ship");
    assert.deepEqual(card.changes, [{ field: "assignees", from: [], to: ["p1"] }]);
    assert.deepEqual(
      (store.calls.create[0].request as Json).final_assignee_person_ids,
      ["p1"],
      "the stored request is the resolved list, not the delta",
    );

    const confirmed = await client.callTool({
      name: "confirm_action",
      arguments: { preview_id: "preview-1" },
    });
    assert.equal(confirmed.isError, undefined);
    assert.equal(bodyOf(confirmed).replayed, false);
    assert.equal(store.calls.apply, 1, "confirm is the only path to applyAdminAction");
    assert.deepEqual(store.calls.confirm, [{ previewId: "preview-1", key: "mcp:confirm:preview-1" }]);
    assert.deepEqual(bodyOf(confirmed).result, { task: { id: "task-1" } });

    const replay = await client.callTool({
      name: "confirm_action",
      arguments: { preview_id: "preview-1" },
    });
    assert.equal(replay.isError, undefined);
    assert.equal(bodyOf(replay).replayed, true);
    assert.equal(store.calls.apply, 1, "a repeated confirm replays instead of applying twice");
  } finally {
    await close();
  }
});

test("a repeated preview_action mints a fresh preview after the window expires", async () => {
  const base = Date.UTC(2026, 10, 2, 12, 0, 0);
  const realNow = Date.now;
  const writes: string[] = [];
  const store = previewStore();
  const services = createAdminAgentMcpServices({
    actions: actionServices(writes),
    applyAction: async () => {
      store.calls.apply += 1;
      return { status: 200, body: { task: { id: "task-1" } } };
    },
    previews: { create: store.create, record: store.record, confirm: store.confirm },
  });
  const { client, close } = await connect(services);
  try {
    // The derived key is stable inside one TTL window and moves with the window.
    const payload = ASSIGN_ARGUMENTS.payload;
    assert.equal(
      adminPreviewIdempotencyKey("task.assign", payload, base),
      adminPreviewIdempotencyKey("task.assign", payload, base + 1),
    );
    assert.notEqual(
      adminPreviewIdempotencyKey("task.assign", payload, base),
      adminPreviewIdempotencyKey("task.assign", payload, base + ADMIN_PREVIEW_TTL_MS),
    );
    assert.ok(adminPreviewIdempotencyKey("task.assign", payload, base).length <= 160);

    Date.now = () => base;
    const first = await client.callTool({ name: "preview_action", arguments: ASSIGN_ARGUMENTS });
    const retried = await client.callTool({ name: "preview_action", arguments: ASSIGN_ARGUMENTS });
    assert.equal(first.isError, undefined);
    assert.equal(bodyOf(retried).id, bodyOf(first).id, "a retry inside the window replays");
    assert.equal(store.byId.size, 1, "only one preview row exists inside the window");

    // Let the card expire. Confirming it is the dead end the TTL bucket fixes.
    Date.now = () => base + ADMIN_PREVIEW_TTL_MS;
    const expired = await client.callTool({
      name: "confirm_action",
      arguments: { preview_id: bodyOf(first).id },
    });
    assert.equal(expired.isError, true);
    assert.equal(bodyOf(expired).code, "preview_expired");
    assert.equal(store.calls.apply, 0);

    // The next identical request must mint a fresh card rather than replay the
    // expired row, so the action is still reachable and confirmable.
    const fresh = await client.callTool({ name: "preview_action", arguments: ASSIGN_ARGUMENTS });
    assert.equal(fresh.isError, undefined);
    assert.notEqual(bodyOf(fresh).id, bodyOf(first).id);
    assert.equal(store.byId.size, 2);
    assert.notEqual(store.calls.create[0].key, store.calls.create.at(-1)?.key);

    const confirmed = await client.callTool({
      name: "confirm_action",
      arguments: { preview_id: bodyOf(fresh).id },
    });
    assert.equal(confirmed.isError, undefined);
    assert.equal(bodyOf(confirmed).replayed, false);
    assert.equal(store.calls.apply, 1);
  } finally {
    Date.now = realNow;
    await close();
  }
});

test("preview_action forwards an explicit idempotency key", async () => {
  const store = previewStore();
  const services = createAdminAgentMcpServices({
    actions: actionServices([]),
    applyAction: async () => ({ status: 200, body: { task: { id: "task-1" } } }),
    previews: { create: store.create, record: store.record, confirm: store.confirm },
  });
  const { client, close } = await connect(services);
  try {
    const result = await client.callTool({
      name: "preview_action",
      arguments: { ...ASSIGN_ARGUMENTS, idempotency_key: "manual-preview-key" },
    });
    assert.equal(result.isError, undefined);
    assert.equal(store.calls.create[0].key, "manual-preview-key");
  } finally {
    await close();
  }
});

test("confirm_action honours an explicit idempotency key", async () => {
  const { calls, services } = fakeServices();
  const { client, close } = await connect(services);
  await client.callTool({
    name: "confirm_action",
    arguments: { preview_id: "preview-2", idempotency_key: "manual-key" },
  });
  assert.deepEqual(calls.confirm[0], { previewId: "preview-2", key: "manual-key" });
  await close();
});

test("write tools spend the shared write budget and report retry_after", async () => {
  const { calls, services } = fakeServices();
  const { client, close } = await connect(services);
  try {
    let limited: Json | null = null;
    for (let index = 0; index <= AGENT_RATE_LIMIT_MAX_WRITES; index += 1) {
      const result = await client.callTool({
        name: "log_progress",
        arguments: { task_id: "t1", summary: `Note ${index}` },
      });
      if (result.isError) {
        limited = bodyOf(result);
        break;
      }
    }
    assert.ok(limited, "the write budget must eventually refuse a call");
    assert.equal(limited.code, "rate_limited");
    assert.equal(typeof limited.retry_after, "number");
    assert.ok(Number(limited.retry_after) >= 1);
    assert.equal(calls.progress.length, AGENT_RATE_LIMIT_MAX_WRITES);
  } finally {
    await close();
  }
});

test("attach_evidence enforces the 8 MB base64 bound before the service", async () => {
  const { calls, services } = fakeServices();
  const { client, close } = await connect(services);
  try {
    const oversized = await client.callTool({
      name: "attach_evidence",
      arguments: {
        task_id: "t1",
        file_name: "large.txt",
        content_type: "text/plain",
        content_base64: Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64"),
      },
    });
    assert.equal(oversized.isError, true);
    assert.equal(bodyOf(oversized).code, "file_too_large");
    assert.equal(calls.evidence.length, 0, "the decoder bounds the file before the service");

    const attached = await client.callTool({
      name: "attach_evidence",
      arguments: {
        task_id: "t1",
        file_name: "screen.png",
        content_type: "image/png",
        content_base64: png.toString("base64"),
        note: "done",
      },
    });
    assert.equal(attached.isError, undefined);
    assert.equal(calls.evidence.length, 1);
    assert.equal(calls.evidence[0].bytes, png.length);
    assert.equal(calls.evidence[0].note, "done");
    assert.match(calls.evidence[0].key, /^mcp:attach_evidence:[0-9a-f]{64}$/);
  } finally {
    await close();
  }
});

test("log_progress is a direct additive write with tasks:write", async () => {
  const { calls, services } = fakeServices();
  const authorized = await connect(services, ["tasks:read", "tasks:write"]);
  const result = await authorized.client.callTool({
    name: "log_progress",
    arguments: { task_id: "t1", summary: "Shipped the first slice" },
  });
  assert.equal(result.isError, undefined);
  assert.equal(calls.progress.length, 1);
  assert.deepEqual(calls.progress[0].body, { summary: "Shipped the first slice" });
  assert.match(calls.progress[0].key, /^mcp:log_progress:[0-9a-f]{64}$/);
  await authorized.close();

  const readOnly = await connect(services, ["tasks:read"]);
  const denied = await readOnly.client.callTool({
    name: "log_progress",
    arguments: { task_id: "t1", summary: "Nope" },
  });
  assert.equal(denied.isError, true);
  assert.equal(bodyOf(denied).code, "insufficient_scope");
  assert.equal(calls.progress.length, 1, "no second write after the refusal");
  await readOnly.close();
});

test("every read tool enforces its own scope", async () => {
  const { services } = fakeServices();
  const { client, close } = await connect(services, []);
  try {
    for (const [name, args] of [
      ["search_people", {}],
      ["get_person", { person_id: "p1" }],
      ["list_tasks", {}],
      ["get_task", { task_id: "t1" }],
      ["list_eods", {}],
      ["get_eod", { report_id: "e1" }],
      ["list_records", {}],
      ["get_overview", {}],
      ["get_insights", {}],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, `${name} must refuse a scopeless token`);
      assert.equal(bodyOf(result).code, "insufficient_scope", name);
    }
  } finally {
    await close();
  }
});

test("read tools call the matching admin service with mapped arguments", async () => {
  const { calls, services } = fakeServices();
  const { client, close } = await connect(services);
  try {
    await client.callTool({
      name: "search_people",
      arguments: { query: "ada", active: false, team_id: "team-1", role: "admin", limit: 5, cursor: "c1" },
    });
    assert.deepEqual(calls.people[0], {
      query: "ada",
      active: false,
      teamId: "team-1",
      role: "admin",
      limit: 5,
      cursor: "c1",
    });

    await client.callTool({
      name: "list_tasks",
      arguments: { person_ids: ["p1"], status: "active", overdue: true, limit: 2 },
    });
    assert.deepEqual(calls.tasks[0], { person_ids: ["p1"], status: "active", overdue: true, limit: 2 });

    await client.callTool({
      name: "list_eods",
      arguments: { person_ids: ["p1"], status: "pending_review", from: "2026-11-01", to: "2026-11-02" },
    });
    assert.deepEqual(calls.eods[0], {
      person_ids: ["p1"],
      status: "pending_review",
      from: "2026-11-01",
      to: "2026-11-02",
    });

    await client.callTool({
      name: "list_records",
      arguments: { sources: ["submitted_eod", "task"], query: "deploy" },
    });
    assert.deepEqual(calls.records[0], { sources: ["submitted_eod", "task"], query: "deploy" });

    await client.callTool({ name: "get_overview", arguments: { date: "2026-11-02" } });
    assert.deepEqual(calls.overview[0], { date: "2026-11-02" });

    await client.callTool({ name: "get_insights", arguments: { range: "30d", person_id: "p1" } });
    assert.deepEqual(calls.insights[0], { range: "30d", person_id: "p1" });

    const task = await client.callTool({ name: "get_task", arguments: { task_id: "t1" } });
    assert.equal((bodyOf(task).task as Json).id, "t1");
  } finally {
    await close();
  }
});

test("a missing person or report is a not_found tool error", async () => {
  const { services } = fakeServices();
  const { client, close } = await connect(services);
  try {
    for (const [name, args] of [
      ["get_person", { person_id: "missing" }],
      ["get_eod", { report_id: "missing" }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true);
      assert.equal(bodyOf(result).code, "not_found");
    }
  } finally {
    await close();
  }
});

test("tool input shapes are strict and unknown fields are errors", async () => {
  const { calls, services } = fakeServices();
  const { client, close } = await connect(services);
  try {
    for (const [name, args] of [
      ["search_people", { query: "ada", typo: true }],
      ["get_task", { task_id: "t1", typo: true }],
      ["list_records", { sources: ["task"], typo: true }],
      ["get_overview", { typo: true }],
      ["confirm_action", { preview_id: "preview-1", typo: true }],
      ["log_progress", { task_id: "t1", summary: "Note", typo: true }],
      ["attach_evidence", {
        task_id: "t1", file_name: "a.txt", content_type: "text/plain",
        content_base64: png.toString("base64"), typo: true,
      }],
      ["preview_action", {
        action: "task.assign",
        payload: { task_id: "t1", mode: "add", person_ids: ["p1"] },
        typo: true,
      }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, `${name} must reject unknown fields`);
    }
    assert.equal(calls.preview.length, 0);
    assert.equal(calls.confirm.length, 0);
    assert.equal(calls.progress.length, 0);
    assert.equal(calls.evidence.length, 0);

    // Unknown fields inside a preview payload are rejected by the discriminated union.
    const nested = await client.callTool({
      name: "preview_action",
      arguments: {
        action: "task.assign",
        payload: { task_id: "t1", mode: "add", person_ids: ["p1"], retarget: true },
      },
    });
    assert.equal(nested.isError, true);
    assert.match(textOf(nested), /unrecognized|validation/i);
    assert.equal(calls.preview.length, 0);

    // The action discriminator restricts the nine documented actions.
    const unknownAction = await client.callTool({
      name: "preview_action",
      arguments: { action: "task.explode", payload: { task_id: "t1" } },
    });
    assert.equal(unknownAction.isError, true);
    assert.equal(calls.preview.length, 0);
  } finally {
    await close();
  }
});
