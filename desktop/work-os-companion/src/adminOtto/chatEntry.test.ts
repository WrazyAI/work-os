import { describe, expect, it, vi } from "vitest";
import type { ChatResult, OttoScope, ReviewedRecap } from "../../../../src/modules/work-os/admin-otto/contracts";
import { createAdminOttoEntryController } from "./chatEntry";
import type { AdminOttoThreadView } from "./api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const thread = (conversationId = "known-thread"): AdminOttoThreadView => ({
  conversationId, contextVersion: 1, turns: [], result: null, resultStatus: "ready",
});

const scope: OttoScope = { userId: "user-1", organizationId: "org-1", mode: "admin" };

const result = (turnId: string, conversationId = "conversation-1"): ChatResult => ({
  conversationId,
  turnId,
  reply: `reply ${turnId}`,
  result: null,
  contextVersion: 1,
});

describe("admin Otto entry controller", () => {
  it("binds a recovered conversation before hydration/effects and blocks sending until the GET succeeds", async () => {
    const load = deferred<AdminOttoThreadView>();
    const sent: Array<{ conversationId: string | null; requestId: string }> = [];
    const controller = createAdminOttoEntryController({ scope, initialConversationId: "known-thread",
      initialDraft: "retry follow-up", initialRequestId: "retained-request", load: () => load.promise,
      send: async (input) => { sent.push(input); return result("answer", "known-thread"); },
    });
    expect(controller.snapshot().conversationId).toBe("known-thread");
    await controller.submit(); // even before the mount effect calls open()
    const opening = controller.open("known-thread");
    await controller.submit();
    expect(sent).toEqual([]);
    expect(controller.snapshot()).toMatchObject({ hydration: "loading", draft: "retry follow-up" });
    load.resolve(thread()); await opening;
    await controller.submit();
    expect(sent).toEqual([expect.objectContaining({ conversationId: "known-thread", requestId: "retained-request" })]);
  });

  it("failed hydration keeps identity/draft, prohibits new-thread sends and supports an explicit retry", async () => {
    let calls = 0;
    const sent: Array<{ conversationId: string | null }> = [];
    const controller = createAdminOttoEntryController({ scope, initialConversationId: "known-thread", initialDraft: "follow-up",
      load: async () => { if (++calls === 1) throw new Error("GET unavailable"); return thread(); },
      send: async (input) => { sent.push(input); return result("answer", "known-thread"); },
    });
    await controller.open("known-thread");
    expect(controller.snapshot()).toMatchObject({ conversationId: "known-thread", hydration: "failed", error: "GET unavailable" });
    controller.setDraft("edited follow-up");
    await controller.submit();
    expect(sent).toEqual([]);
    expect(controller.snapshot().error).toBe("GET unavailable");
    await controller.open("known-thread");
    expect(controller.snapshot()).toMatchObject({ hydration: "idle", draft: "edited follow-up", error: null });
    await controller.submit();
    expect(sent[0].conversationId).toBe("known-thread");
  });

  it.each(["cancel", "new_account", "dispose"] as const)("fences delayed thread hydration after %s", async (boundary) => {
    const load = deferred<AdminOttoThreadView>();
    const send = vi.fn(async () => result("answer"));
    let signal: AbortSignal | undefined;
    const controller = createAdminOttoEntryController({ scope, initialConversationId: "known-thread", initialDraft: "old draft",
      send, load: (_id, currentSignal) => { signal = currentSignal; return load.promise; },
    });
    const opening = controller.open("known-thread");
    if (boundary === "cancel") controller.cancel();
    else if (boundary === "dispose") controller.dispose();
    else controller.reset({ userId: "user-2", organizationId: "org-1", mode: "admin" });
    load.resolve({ ...thread(), turns: [{ turnId: "old-turn", role: "assistant", text: "old account result", createdAt: "" }] });
    await opening;
    expect(signal?.aborted).toBe(true);
    expect(controller.snapshot().turns).toEqual([]);
    if (boundary === "new_account") expect(controller.snapshot()).toMatchObject({ conversationId: null, draft: "", hydration: "idle" });
    else {
      expect(controller.snapshot()).toMatchObject({ conversationId: "known-thread", hydration: "failed", draft: "old draft" });
      await controller.submit();
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a hydration response for a different conversation", async () => {
    const controller = createAdminOttoEntryController({ scope, initialConversationId: "known-thread",
      send: async () => result("answer"), load: async () => thread("foreign-thread"),
    });
    await controller.open("known-thread");
    expect(controller.snapshot()).toMatchObject({ conversationId: "known-thread", hydration: "failed", turns: [] });
  });
  it("keeps an indeterminate request id and draft across context recovery/remount", async () => {
    let resolve!: (value: ChatResult) => void;
    const first = createAdminOttoEntryController({ scope, createRequestId: () => "original",
      send: () => new Promise((done) => { resolve = done; }),
    });
    first.setDraft("keep this question");
    const pending = first.submit();
    const recovery = first.recovery();
    first.dispose();
    const sent: string[] = [];
    const second = createAdminOttoEntryController({ scope, initialDraft: recovery.draft, initialRequestId: recovery.requestId,
      send: async (input) => { sent.push(input.requestId); return result("new"); },
    });
    await second.submit();
    resolve(result("old")); await pending;
    expect(sent).toEqual(["original"]);
    expect(second.snapshot().turns.map((turn) => turn.text)).toEqual(["keep this question", "reply new"]);
  });
  it("keeps a draft and request id on failure, then retries it", async () => {
    let attempt = 0;
    const send = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network");
      return result("turn-2");
    });
    const controller = createAdminOttoEntryController({
      scope,
      send,
      createRequestId: () => `request-${attempt + 1}`,
    });
    controller.setDraft("show unfinished work");
    await controller.submit();
    expect(controller.snapshot()).toMatchObject({ busy: false, draft: "show unfinished work", error: "network" });
    expect(controller.snapshot().turns).toHaveLength(0);
    await controller.submit();
    expect(controller.snapshot()).toMatchObject({ busy: false, draft: "", error: null });
    expect(controller.snapshot().turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(send).toHaveBeenCalledTimes(2);
    // An indeterminate first attempt is retried with the same request id so the
    // server can replay rather than creating a duplicate turn.
    expect((send.mock.calls[1] as unknown as [Record<string, unknown>])[0].requestId).toBe("request-1");
  });

  it("cancels an attempt without rendering its late response", async () => {
    let resolve!: (value: ChatResult) => void;
    const send = vi.fn(() => new Promise<ChatResult>((done) => { resolve = done; }));
    const controller = createAdminOttoEntryController({
      scope, send, createRequestId: () => "request-1",
    });
    controller.setDraft("stale question");
    const pending = controller.submit();
    controller.cancel();
    resolve(result("late-turn"));
    await pending;
    expect(controller.snapshot()).toMatchObject({ busy: false, draft: "stale question", turns: [] });
  });

  it("new chat aborts an in-flight send and cannot write the old conversation back", async () => {
    let resolve!: (value: ChatResult) => void;
    let signal: AbortSignal | undefined;
    const controller = createAdminOttoEntryController({
      scope,
      initialConversationId: "old-conversation",
      send: (_input, currentSignal) => {
        signal = currentSignal;
        return new Promise<ChatResult>((done) => { resolve = done; });
      },
      createRequestId: () => "request-1",
    });
    controller.setDraft("old question");
    const pending = controller.submit();
    controller.reset(scope, null);
    expect(signal?.aborted).toBe(true);
    resolve(result("old-turn", "old-conversation"));
    await pending;
    expect(controller.snapshot()).toMatchObject({
      conversationId: null,
      turns: [],
      draft: "",
      busy: false,
      hydration: "idle",
    });
    // The component only writes onConversation when this snapshot id is
    // non-null, so the late old thread cannot be reported back to App.
    const conversationRef = { current: null as string | null };
    if (controller.snapshot().conversationId && controller.snapshot().conversationId !== conversationRef.current) {
      conversationRef.current = controller.snapshot().conversationId;
    }
    expect(conversationRef.current).toBe(null);
  });

  it("ignores a response from the previous account/scope", async () => {
    let resolve!: (value: ChatResult) => void;
    const controller = createAdminOttoEntryController({
      scope,
      send: () => new Promise<ChatResult>((done) => { resolve = done; }),
      createRequestId: () => "request-1",
    });
    controller.setDraft("old account question");
    const pending = controller.submit();
    controller.reset({ userId: "user-2", organizationId: "org-1", mode: "admin" });
    resolve(result("old-account-turn"));
    await pending;
    expect(controller.snapshot().turns).toEqual([]);
    expect(controller.snapshot().draft).toBe("");
  });

  it("rehydrates the latest result only on the last assistant turn", async () => {
    const recap = {
      intervalId: "interval-1", eventId: "event-1",
      person: { id: "person-1", displayName: "Ada", active: true, timezone: "UTC" },
      reviewVersion: 1, reviewKey: "key", sourceRevision: 1, scriptHash: "hash",
      reviewStatus: "confirmed", reviewedAt: "2026-10-26T10:00:00.000Z",
      windowStart: "2026-10-26T09:00:00.000Z", windowEnd: "2026-10-26T10:00:00.000Z", timezone: "UTC",
      original: { headline: "", detail: "", activities: [] }, employeeFeedback: null,
      speechLines: [], coverage: [],
    } satisfies ReviewedRecap;
    const controller = createAdminOttoEntryController({
      scope,
      send: async () => result("turn-1"),
      load: async () => ({
        conversationId: "conversation-1",
        contextVersion: 1,
        turns: [
          { turnId: "turn-1", role: "assistant", text: "old", createdAt: "" },
          { turnId: "turn-2", role: "assistant", text: "new", createdAt: "" },
        ],
        result: { kind: "recap", recap },
        resultStatus: "ready",
      }),
      createRequestId: () => "request-1",
    });
    await controller.open("conversation-1");
    const turns = controller.snapshot().turns;
    expect(turns[0].result).toBeNull();
    expect(turns[1].result).toMatchObject({ kind: "recap" });
  });
});
