import { describe, expect, it } from "vitest";
import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { OTTO_VIEW_REQUEST_EVENT, OTTO_VIEW_RESULT_EVENT, OTTO_VIEW_STATE_EVENT, buildOttoViewState, parseOttoViewRequest, parseOttoViewResult, parseOttoViewState, resolveViewAvailability, resolveWorkspaceSwitch } from "./viewSwitch";

const scope: OttoScope = { userId: "user-1", organizationId: "org-1", mode: "admin" };
const base = {
  scope,
  epoch: 4,
  revision: 3,
  workspace: "admin" as const,
  role: "admin" as const,
  adminStatus: "ready" as const,
  personId: "person-1",
  voiceAvailable: true,
  transcriptionAvailable: false,
  adminConversationId: "conversation-1",
  adminConversationGeneration: 2,
  adminConversationRevision: 5,
  adminConversationBusy: false,
};

describe("Otto view availability", () => {
  it("mapped_admin_availability_matches_bootstrap", () => {
    expect(resolveViewAvailability({ role: "admin", adminStatus: "ready", personId: "person-1" })).toEqual({
      employee: { available: true, reason: null },
      admin: { available: true, reason: null },
    });
    expect(resolveWorkspaceSwitch({ requested: "employee", current: "admin", role: "admin", adminStatus: "ready", personId: "person-1", online: true, resetting: false }))
      .toEqual({ ok: true });
  });

  it("failed_context_blocks_both_destinations", () => {
    const result = resolveViewAvailability({ role: "admin", adminStatus: "failed", personId: "person-1" });
    expect(result.employee).toEqual({ available: false, reason: "Your workspace is unavailable until Administration connects." });
    expect(result.admin).toEqual({ available: false, reason: "Administration is unavailable." });
    expect(resolveWorkspaceSwitch({ requested: "employee", current: "admin", role: "admin", adminStatus: "failed", personId: "person-1", online: true, resetting: false }))
      .toEqual({ ok: false, reason: "employee_unavailable" });
  });

  it("loading_does_not_guess_ready", () => {
    expect(resolveViewAvailability({ role: "admin", adminStatus: "loading", personId: null })).toEqual({
      employee: { available: false, reason: "Loading your workspace…" },
      admin: { available: false, reason: "Loading Administration…" },
    });
    expect(resolveWorkspaceSwitch({ requested: "admin", current: "employee", role: "admin", adminStatus: "loading", personId: null, online: true, resetting: false }))
      .toEqual({ ok: false, reason: "admin_loading" });
  });

  it("unmapped_admin_keeps_admin_only", () => {
    expect(resolveViewAvailability({ role: "admin", adminStatus: "ready", personId: null })).toEqual({
      employee: { available: false, reason: "No personal workday is mapped." },
      admin: { available: true, reason: null },
    });
    expect(resolveWorkspaceSwitch({ requested: "employee", current: "admin", role: "admin", adminStatus: "ready", personId: null, online: true, resetting: false }))
      .toEqual({ ok: false, reason: "employee_unavailable" });
  });

  it("non_admin_has_no_admin_switch", () => {
    expect(resolveViewAvailability({ role: "employee", adminStatus: "absent", personId: "person-1" })).toEqual({
      employee: { available: true, reason: null },
      admin: { available: false, reason: "Administration is not available for this account." },
    });
    expect(resolveWorkspaceSwitch({ requested: "admin", current: "employee", role: "employee", adminStatus: "absent", personId: "person-1", online: true, resetting: false }))
      .toEqual({ ok: false, reason: "admin_unavailable" });
  });

  it("offline_and_resetting_refuse_switch", () => {
    const input = { requested: "admin" as const, current: "employee" as const, role: "admin" as const, adminStatus: "ready" as const, personId: "person-1", online: true, resetting: false };
    expect(resolveWorkspaceSwitch({ ...input, online: false })).toEqual({ ok: false, reason: "offline" });
    expect(resolveWorkspaceSwitch({ ...input, resetting: true })).toEqual({ ok: false, reason: "new_chat_pending" });
    expect(resolveWorkspaceSwitch({ ...input, requested: "employee" })).toEqual({ ok: true });
  });
});

describe("Otto view wire contract", () => {
  it("request_requires_epoch", () => {
    expect(parseOttoViewRequest({ requestId: "request-1", scope, epoch: 2, action: "switch", mode: "admin" }))
      .toEqual({ requestId: "request-1", scope, epoch: 2, action: "switch", mode: "admin" });
    expect(parseOttoViewRequest({ requestId: "request-1", scope, action: "switch", mode: "admin" })).toBeNull();
    for (const epoch of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseOttoViewRequest({ requestId: "request-1", scope, epoch, action: "switch", mode: "admin" })).toBeNull();
    }
    expect(parseOttoViewRequest({ requestId: "request-1", scope, epoch: 2, action: "other", mode: "admin" })).toBeNull();
    expect(parseOttoViewRequest({ requestId: "request-1", scope: { ...scope, mode: "owner" }, epoch: 2, action: "switch", mode: "admin" })).toBeNull();
  });

  it("parsers_strip_secrets_and_reject_invalid_shapes", () => {
    const state = buildOttoViewState(base);
    const leaked = {
      ...state,
      token: "secret-token",
      scope: { ...state.scope, token: "secret-token" },
      adminConversationText: "do not leak",
    };
    const parsed = parseOttoViewState(leaked);
    expect(parsed).toEqual(state);
    expect(JSON.stringify(parsed)).not.toContain("secret");
    expect(parseOttoViewState({ ...state, employeeAvailable: "true" })).toBeNull();
    expect(parseOttoViewState({ ...state, workspace: "employee" })).toBeNull();
    expect(parseOttoViewState({ ...state, epoch: 0 })).toBeNull();
    expect(parseOttoViewState({ ...state, adminConversationGeneration: -1 })).toBeNull();
    expect(parseOttoViewState({ ...state, scope: { userId: "", organizationId: "org-1", mode: "admin" } })).toBeNull();
    expect(parseOttoViewState({ ...state, personId: "person-1".repeat(1000) })).toBeNull();
    expect(parseOttoViewResult({ requestId: "request-1", scope, epoch: 2, action: "switch", mode: "admin", accepted: false, reason: "admin_loading", token: "x" }))
      .toEqual({ requestId: "request-1", scope, epoch: 2, action: "switch", mode: "admin", accepted: false, reason: "admin_loading" });
    expect(parseOttoViewResult({ requestId: "request-1", scope, epoch: 2, action: "switch", mode: "admin", accepted: "yes", reason: null })).toBeNull();
    expect(parseOttoViewResult({ requestId: "request-1", scope, epoch: 2, action: "switch", mode: "admin", accepted: false, reason: "not-a-reason" })).toBeNull();
  });

  it("builds availability from the one bootstrap rule and never mutates input", () => {
    const input = { ...base };
    const state = buildOttoViewState(input);
    expect(state.employeeAvailable).toBe(true);
    expect(state.adminAvailable).toBe(true);
    expect(input).toEqual(base);
    expect(OTTO_VIEW_STATE_EVENT).toBe("work-os://otto-view-state");
    expect(OTTO_VIEW_REQUEST_EVENT).toBe("work-os://otto-view-request");
    expect(OTTO_VIEW_RESULT_EVENT).toBe("work-os://otto-view-result");
  });
});

describe("Otto record navigation", () => {
  it("accepts only a same-app administration path", async () => {
    const { parseOttoRecordNavigationEvent } = await import("./viewSwitch");
    expect(parseOttoRecordNavigationEvent({ scope, epoch: 2, generation: 1, url: "/work-os/admin/tasks?task=t1" })).toEqual({
      scope, epoch: 2, generation: 1, url: "/work-os/admin/tasks?task=t1",
    });
    for (const url of ["https://evil.example/", "//evil.example/x", "/work-os/admin/../x", "javascript:alert(1)", "work-os/admin/tasks", "/api/work-os/admin/tasks"]) {
      expect(parseOttoRecordNavigationEvent({ scope, epoch: 2, generation: 1, url })).toBeNull();
    }
    expect(parseOttoRecordNavigationEvent({ scope, epoch: 0, generation: 1, url: "/work-os/admin/tasks" })).toBeNull();
  });
});
