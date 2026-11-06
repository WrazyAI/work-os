import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResult, OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { createAdminOttoEntryController } from "./chatEntry";
import {
  createAdminConversationClient,
  createAdminConversationEventTransport,
  createAdminConversationOwner,
  createLocalAdminConversationTransport,
  OTTO_CONVERSATION_REQUEST_EVENT,
  OTTO_CONVERSATION_RESULT_EVENT,
  parseAdminConversationRequest,
  type AdminConversationState,
} from "./conversationSync";

const scope: OttoScope = { userId: "user-1", organizationId: "org-1", mode: "admin" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup(options: { conversationId?: string | null; discard?: (input: { conversationId: string | null; requestId: string | null }) => Promise<void> } = {}) {
  const published: AdminConversationState[] = [];
  let discardHandler = options.discard;
  const owner = createAdminConversationOwner({
    getLiveFence: () => ({ scope: owner.snapshot().scope, epoch: owner.snapshot().epoch, generation: owner.snapshot().generation }),
    discard: async (input) => {
      if (discardHandler) return discardHandler(input);
    },
    publish: (state) => published.push(state),
  });
  owner.setContext({ scope, epoch: 5, conversationId: options.conversationId ?? null });
  const client = createAdminConversationClient({
    windowId: "main",
    getFence: () => ({ scope: owner.snapshot().scope, epoch: owner.snapshot().epoch, generation: owner.snapshot().generation }),
    transport: createLocalAdminConversationTransport(owner),
  });
  return { owner, published, client };
}

const result = (conversationId: string): ChatResult => ({
  conversationId,
  turnId: "turn-1",
  reply: "Done.",
  result: null,
  contextVersion: 1,
});

describe("admin conversation runtime coordination", () => {
  it("new chat fences a pending first send and its late finish cannot revive the thread", async () => {
    const h = setup();
    const response = deferred<ChatResult>();
    let begin!: () => void;
    const begun = new Promise<void>((resolve) => { begin = resolve; });
    const entry = createAdminOttoEntryController({
      scope,
      createRequestId: () => "request-1",
      discard: (input) => h.client.discard(input),
      send: async (input: ChatRequest) => {
        const ticket = await h.client.beginSend({ requestId: input.requestId, conversationId: input.conversationId });
        begin();
        const answer = await response.promise;
        await h.client.finishSend(ticket, answer.conversationId);
        return answer;
      },
    });
    entry.setDraft("create the first task");
    const submitting = entry.submit();
    await begun;
    expect(h.owner.snapshot()).toMatchObject({ busy: true, conversationId: null, generation: 1 });
    await entry.newChat();
    expect(h.owner.snapshot()).toMatchObject({ conversationId: null, generation: 2, resetting: false });
    response.resolve(result("late-first-thread"));
    await submitting.catch(() => undefined);
    expect(entry.snapshot().conversationId).toBeNull();
    expect(entry.snapshot().turns).toEqual([]);
    expect(h.owner.snapshot().conversationId).toBeNull();
  });

  it("a failed reset keeps the owner identity and the entry recovery", async () => {
    let attempts = 0;
    const h = setup({
      conversationId: "conversation-1",
      discard: async () => {
        attempts += 1;
        throw new Error("The old chat could not be discarded.");
      },
    });
    const entry = createAdminOttoEntryController({
      scope,
      initialConversationId: "conversation-1",
      discard: (input) => h.client.discard(input),
      send: async () => result("conversation-1"),
    });
    await expect(entry.newChat()).rejects.toThrow("could not be discarded");
    expect(attempts).toBe(1);
    expect(entry.snapshot()).toMatchObject({ conversationId: "conversation-1", busy: false });
    expect(entry.snapshot().error).toContain("could not be discarded");
    expect(h.owner.snapshot()).toMatchObject({ conversationId: "conversation-1", generation: 1, resetting: false });
  });
});

describe("admin conversation event transport", () => {
  it("round-trips begin and finish through an owner request listener", async () => {
    const handlers = new Map<string, Set<(payload: unknown) => void>>();
    const bus = {
      emit(event: string, payload: unknown) {
        for (const handler of handlers.get(event) ?? []) handler({ event, id: 0, payload });
      },
      listen(event: string, handler: (message: unknown) => void) {
        const group = handlers.get(event) ?? new Set();
        group.add(handler);
        handlers.set(event, group);
        return () => group.delete(handler);
      },
    };
    const h = setup();
    const { createAdminConversationEventTransport, parseAdminConversationRequest, OTTO_CONVERSATION_REQUEST_EVENT, OTTO_CONVERSATION_RESULT_EVENT } = await import("./conversationSync");
    const stopRequests = bus.listen(OTTO_CONVERSATION_REQUEST_EVENT, (message) => {
      const request = parseAdminConversationRequest((message as { payload?: unknown })?.payload);
      if (!request) return;
      void h.owner.handle(request).then((result) => bus.emit(OTTO_CONVERSATION_RESULT_EVENT, result));
    });
    const transport = await createAdminConversationEventTransport({ bus });
    const client = (await import("./conversationSync")).createAdminConversationClient({
      windowId: "avatar",
      getFence: () => {
        const snapshot = h.owner.snapshot();
        return { scope: snapshot.scope, epoch: snapshot.epoch, generation: snapshot.generation };
      },
      transport: transport.transport,
    });
    const ticket = await client.beginSend({ requestId: "request-remote", conversationId: null });
    expect(h.owner.snapshot().busy).toBe(true);
    await client.finishSend(ticket, "conversation-remote");
    expect(h.owner.snapshot().conversationId).toBe("conversation-remote");
    stopRequests();
    transport.dispose();
  });

  it("keeps the conversation id after the floating window unmounts so a reopen hydrates history", async () => {
    const handlers = new Map<string, Set<(payload: unknown) => void>>();
    const bus = {
      emit(event: string, payload: unknown) {
        for (const handler of handlers.get(event) ?? []) handler({ event, id: 0, payload });
      },
      listen(event: string, handler: (message: unknown) => void) {
        const group = handlers.get(event) ?? new Set();
        group.add(handler);
        handlers.set(event, group);
        return () => group.delete(handler);
      },
    };
    const h = setup();
    const stopRequests = bus.listen(OTTO_CONVERSATION_REQUEST_EVENT, (message) => {
      const request = parseAdminConversationRequest((message as { payload?: unknown })?.payload);
      if (!request) return;
      void h.owner.handle(request).then((result) => bus.emit(OTTO_CONVERSATION_RESULT_EVENT, result));
    });
    const transport = await createAdminConversationEventTransport({ bus });
    const client = createAdminConversationClient({
      windowId: "avatar",
      getFence: () => {
        const snapshot = h.owner.snapshot();
        return { scope: snapshot.scope, epoch: snapshot.epoch, generation: snapshot.generation };
      },
      transport: transport.transport,
    });
    const floating = createAdminOttoEntryController({
      scope,
      createRequestId: () => "floating-first-request",
      send: async (input: ChatRequest) => {
        const ticket = await client.beginSend({ requestId: input.requestId, conversationId: input.conversationId });
        const answer = result("conversation-first");
        await client.finishSend(ticket, answer.conversationId);
        return answer;
      },
    });
    floating.setDraft("First floating question");
    await floating.submit();
    expect(h.owner.snapshot().conversationId).toBe("conversation-first");
    floating.dispose();

    // Collapse/expand remounts the floating surface. It receives the owner's
    // committed id, not the null it had before the first send, and reloads the
    // recorded turns from the server.
    const reopened = createAdminOttoEntryController({
      scope,
      initialConversationId: h.owner.snapshot().conversationId,
      load: async (conversationId) => ({
        conversationId,
        contextVersion: 1,
        turns: [
          { turnId: "floating-user", role: "user", text: "First floating question", createdAt: "2026-10-27T10:00:00.000Z" },
          { turnId: "floating-assistant", role: "assistant", text: "Done.", createdAt: "2026-10-27T10:00:01.000Z" },
        ],
        result: null,
        resultStatus: "ready" as const,
      }),
      send: async () => result("conversation-first"),
    });
    await reopened.open("conversation-first");
    expect(reopened.snapshot().turns.map((turn) => turn.text))
      .toEqual(["First floating question", "Done."]);
    stopRequests();
    transport.dispose();
  });
});
