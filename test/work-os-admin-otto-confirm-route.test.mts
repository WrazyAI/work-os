import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { adminAccess } from "./helpers/work-os-admin-agent-fixture.mts";

function fixture() {
  let actor: unknown;
  const id = "91000000-0000-4000-8000-000000000021";
  const record = { source: "otto", action: "task.create", request: { name: "Example" }, targetId: null,
    preview: { summary: "Create Example", changes: [], warnings: [], expiresAt: "2099-01-01T00:00:00Z", state: {} } };
  const stubs: Record<string, unknown> = {
    "@/lib/work-os-admin-otto-access": { requireAdminOttoAccess: async () => ({ access: adminAccess }) },
    "@/lib/work-admin-action-previews": { getAdminPreviewRecord: async () => record,
      confirmAdminPreview: async (_a: unknown, _id: unknown, _key: unknown, deps: { apply: () => Promise<unknown> }) => {
        await deps.apply(); return { body: { task: { id } }, replayed: false };
      }, WorkAdminPreviewError: class extends Error {},
    },
    "@/lib/work-admin-agent-actions": { defaultAdminAgentActionServices: {}, adminTaskPreviewState: (v: unknown) => v,
      applyAdminAction: async (...args: unknown[]) => { actor = args[4]; return { status: 201, body: { task: { id } } }; },
    },
    "@/lib/work-os-api": { WorkOsConflictError: class extends Error {}, WorkOsValidationError: class extends Error {}, WorkOsForbiddenError: class extends Error {}, WorkOsNotFoundError: class extends Error {} },
    "@/lib/request-origin": { hasExpectedPublicOrigin: (req: Request) => req.headers.get("origin") === "https://app.example.test" },
    "@/lib/work-os-admin-otto-workflows": { assertOttoWorkflowActive: async () => {}, currentOttoAction: async (_a: unknown, action: object) => ({ ...action, status: "recorded" }) },
    "@/modules/work-os/completion-evidence": { CompletionEvidenceError: class extends Error {} },
  };
  const native = createRequire(import.meta.url);
  const exports: Record<string, unknown> = {};
  const js = ts.transpileModule(readFileSync(new URL("../src/app/api/work-os/admin/otto/actions/[previewId]/confirm/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", "module", js)((id: string) => stubs[id] ?? native(id), exports, { exports });
  return { route: exports as { POST: (req: Request, params: { params: Promise<{ previewId: string }> }) => Promise<Response> }, actor: () => actor, id };
}

test("desktop confirmation returns its versioned receipt and never fabricates a token actor", async () => {
  const f = fixture();
  const response = await f.route.POST(new Request("https://app.example.test/api/confirm", { method: "POST", headers: { authorization: "Bearer desktop" } }), { params: Promise.resolve({ previewId: f.id }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.schemaVersion, 1, "the desktop adapter rejects unversioned receipts even after a successful write");
  assert.equal(body.action.status, "recorded");
  assert.equal((f.actor() as { tokenId: unknown }).tokenId, null);
});

test("cookie confirmation requires the expected origin before applying", async () => {
  const f = fixture();
  const response = await f.route.POST(new Request("https://app.example.test/api/confirm", { method: "POST" }), { params: Promise.resolve({ previewId: f.id }) });
  assert.equal(response.status, 403);
  assert.equal(f.actor(), undefined);
});
