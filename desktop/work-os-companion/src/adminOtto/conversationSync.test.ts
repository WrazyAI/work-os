import { describe, expect, it, vi } from "vitest";
import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import {
  OTTO_CONVERSATION_EVENT,
  OTTO_CONVERSATION_REQUEST_EVENT,
  OTTO_CONVERSATION_RESULT_EVENT,
  createAdminConversationClient,
  createAdminConversationOwner,
  createLocalAdminConversationTransport,
  parseAdminConversationRequest,
  parseAdminConversationResult,
  parseAdminConversationState,
  type AdminConversationRequest,
  type AdminConversationState,
  type AdminConversationTicket,
} from "./conversationSync";

const scope: OttoScope = { userId: "user-1", organizationId: "org-1", mode: "admin" };

function setup(options: {
  discard?: (input: { conversationId: string | null; requestId: string | null }) => Promise<void>;
  conversationId?: string | null;
} = {}) {
  const published: AdminConversationState[] = [];
  const fenced: Array<{ conversationId: string | null; requestId: string | null }> = [];
  const owner = createAdminConversationOwner({
    getLiveFence: () => ({ scope: owner.snapshot().scope, epoch: owner.snapshot().epoch, generation: owner.snapshot().generation }),
    discard: options.discard ?? (async (input) => { fenced.push(input); }),
    publish: (state) => published.push(state),
  });
  owner.setContext({ scope, epoch: 5, conversationId: options.conversationId ?? null });
  let sequence = 0;
  const client = (windowId: "main" | "avatar") => createAdminConversationClient({
    windowId,
    getFence: () => ({ scope: owner.snapshot().scope, epoch: owner.snapshot().epoch, generation: owner.snapshot().generation }),
    transport: createLocalAdminConversationTransport(owner),
    createOperationId: () => `${windowId}-op-${++sequence}`,
  });
  return { owner, published, fenced, main: client("main"), avatar: client("avatar") };
}

describe("admin conversation coordination", () => {
  it("begin_is_registered_before_http_can_start", async () => {
    const h = setup();
    const ticket = await h.main.beginSend({ requestId: "request-1", conversationId: null });
    expect(ticket).toMatchObject({ requestId: "request-1", windowId: "main", conversationId: null, generation: 1 });
    expect(h.owner.snapshot()).toMatchObject({ busy: true, conversationId: null, generation: 1 });
    await expect(h.avatar.beginSend({ requestId: "request-2", conversationId: null }))
      .rejects.toMatchObject({ reason: "busy" });
  });

  it("two_null_thread_first_sends_cannot_fork", async () => {
    const h = setup();
    await h.main.beginSend({ requestId: "request-1", conversationId: null });
    await expect(h.avatar.beginSend({ requestId: "request-2", conversationId: null }))
      .rejects.toMatchObject({ reason: "busy" });
    expect(h.owner.snapshot().conversationId).toBeNull();
  });

  it("peer_first_send_is_fenced_by_new_chat_from_empty_window", async () => {
    const h = setup();
    const ticket = await h.main.beginSend({ requestId: "request-first", conversationId: null });
    await h.avatar.discard({ conversationId: null, requestId: null });
    expect(h.fenced).toEqual([{ conversationId: null, requestId: "request-first" }]);
    expect(h.owner.snapshot()).toMatchObject({ conversationId: null, generation: 2, busy: false, resetting: false });
    await expect(h.main.finishSend(ticket, "late-thread")).rejects.toMatchObject({ reason: "stale_generation" });
  });

  it("discard_failure_retains_identity_generation_and_recovery", async () => {
    let attempts = 0;
    const h = setup({
      conversationId: "conversation-1",
      discard: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("discard unavailable");
      },
    });
    await expect(h.main.discard({ conversationId: "conversation-1", requestId: null }))
      .rejects.toMatchObject({ reason: "discard_failed" });
    expect(h.owner.snapshot()).toMatchObject({ conversationId: "conversation-1", generation: 1, resetting: false });
    await h.main.discard({ conversationId: "conversation-1", requestId: null });
    expect(h.owner.snapshot()).toMatchObject({ conversationId: null, generation: 2, resetting: false });
  });

  it("late_finish_after_reset_cannot_resurrect_thread", async () => {
    const h = setup();
    const ticket = await h.main.beginSend({ requestId: "request-1", conversationId: null });
    await h.main.discard({ conversationId: null, requestId: "request-1" });
    await expect(h.main.finishSend(ticket, "late-thread")).rejects.toMatchObject({ reason: "stale_generation" });
    expect(h.owner.snapshot().conversationId).toBeNull();
  });

  it("round_trip_epoch_rejects_old_begin_and_finish", async () => {
    const h = setup();
    const ticket = await h.main.beginSend({ requestId: "request-1", conversationId: null });
    h.owner.setContext({ scope: { ...scope, mode: "employee" }, epoch: 6 });
    h.owner.setContext({ scope, epoch: 7 });
    await expect(h.main.finishSend(ticket, "thread-1")).rejects.toMatchObject({ reason: "stale_scope" });
    await expect(h.main.beginSend({ requestId: "request-2", conversationId: null }))
      .rejects.toMatchObject({ reason: "pending_other_window" });
    await h.main.discard({ conversationId: null, requestId: null });
    const next = await h.main.beginSend({ requestId: "request-2", conversationId: null });
    expect(next.epoch).toBe(7);
  });

  it("same_id_new_turn_bumps_revision_to_refresh_peer", async () => {
    const h = setup();
    const first = await h.main.beginSend({ requestId: "request-1", conversationId: null });
    await h.main.finishSend(first, "conversation-1");
    const firstSnapshot = h.owner.snapshot();
    const second = await h.main.beginSend({ requestId: "request-2", conversationId: "conversation-1" });
    await h.main.finishSend(second, "conversation-1");
    expect(h.owner.snapshot().revision).toBeGreaterThan(firstSnapshot.revision);
    expect(h.owner.snapshot().generation).toBe(firstSnapshot.generation);
  });

  it("duplicate_operation_id_is_idempotent", async () => {
    const h = setup();
    const request: AdminConversationRequest = {
      type: "begin-send",
      operationId: "operation-1",
      windowId: "main",
      requestId: "request-1",
      scope,
      epoch: 5,
      generation: 1,
      conversationId: null,
    };
    const first = await h.owner.handle(request);
    const second = await h.owner.handle(request);
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(second.ticket).toEqual(first.ticket);
    expect(h.owner.snapshot().busy).toBe(true);
  });

  it("new_account_disposes_pending_acknowledgements", async () => {
    const h = setup();
    const ticket = await h.main.beginSend({ requestId: "request-1", conversationId: null });
    h.owner.setContext({ scope: { userId: "user-2", organizationId: "org-1", mode: "admin" }, epoch: 1 });
    await expect(h.main.finishSend(ticket, "thread-1")).rejects.toMatchObject({ reason: "stale_scope" });
    expect(h.owner.snapshot()).toMatchObject({ conversationId: null, generation: 1, busy: false });
  });

  it("parses ids-only state, request and result", () => {
    const state = h().owner.snapshot();
    expect(parseAdminConversationState({ ...state, turns: [{ text: "secret" }] })).toEqual(state);
    expect(parseAdminConversationState({ ...state, generation: 0 })).toBeNull();
    const request: AdminConversationRequest = {
      type: "discard", operationId: "operation-1", windowId: "main",
      scope, epoch: 5, generation: 1, conversationId: null, requestId: "request-1",
    };
    expect(parseAdminConversationRequest({ ...request, draft: "secret" })).toEqual(request);
    const result = { operationId: "operation-1", windowId: "main" as const, scope, epoch: 5, generation: 1, accepted: true, reason: null, state };
    expect(parseAdminConversationResult({ ...result, text: "secret" })).toEqual(result);
    expect(OTTO_CONVERSATION_EVENT).toBe("work-os://otto-conversation");
    expect(OTTO_CONVERSATION_REQUEST_EVENT).toBe("work-os://otto-conversation-request");
    expect(OTTO_CONVERSATION_RESULT_EVENT).toBe("work-os://otto-conversation-result");
  });
});

function h() { return setup(); }
