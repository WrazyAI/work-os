import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminOttoChat, AdminReplyText, AdminResultCard, createAdminOttoSurfaceController, resetAdminOttoConversation, syncAdminOttoConversation } from "./AdminOttoChat";
import { fixtureInboxPage, fixtureRecordsResult, fixtureTaskResult, FIXTURE_REVIEWED_RECAP } from "./fixtures";
import { parseAdminRecordHref } from "./recordLinks";
import { createAdminAudioInterlock } from "./audioInterlock";

const scope = { userId: "actor", organizationId: "org", mode: "admin" as const };

const render = (props: Partial<Parameters<typeof AdminOttoChat>[0]> = {}) =>
  renderToStaticMarkup(createElement(AdminOttoChat, {
    scope,
    conversationId: null,
    onOpenRecord() {},
    onListen() {},
    ...props,
  }));

describe("admin Otto chat", () => {
  it("chat_and_recaps_are_admin_peer_tabs", () => {
    const html = render();
    expect(html).toContain('data-conversation-surface="in-app"');
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Chat/);
    expect(html).toContain("Recaps");
    expect(html).toContain("Read-only");
    expect(html).toContain("chat-composer");
    expect(html).not.toContain("Clock in");
    expect(html).not.toContain("Clock out");
    // Both peer tabs are reachable through the selected tab's roving tabindex.
    expect(html).toMatch(/role="tab"[^>]*tabindex="0"[^>]*>Chat/);
    expect(html).toMatch(/role="tab"[^>]*tabindex="-1"[^>]*>Recaps/);
  });

  it("single_arrival_offers_listen_and_view", () => {
    const page = fixtureInboxPage({ count: 1, total: 1, nextCursor: null });
    const html = render({
      initialTab: "recaps",
      initialInbox: page,
      arrival: { count: 1, unread: 1, eventIds: [page.items[0].deliveryId], recap: FIXTURE_REVIEWED_RECAP },
    });
    expect(html).toContain("1 reviewed recap is ready");
    expect(html).toContain("Listen");
    expect(html).toContain("View recap");
    expect(html).toContain("Synthetic Ada");
    expect(html).toContain("Showing 1 of 1");
    expect(html).not.toContain("autoFocus");
  });

  it("multiple_arrivals_offer_counted_inbox", () => {
    const page = fixtureInboxPage({ count: 12, total: 25, nextCursor: "next-page" });
    const html = render({
      initialTab: "recaps",
      initialInbox: page,
      arrival: { count: 3, unread: 25, eventIds: page.items.slice(0, 3).map((item) => item.deliveryId), recap: null },
    });
    expect(html).toContain("3 reviewed recaps are ready");
    expect(html).toContain("View inbox");
    expect(html).not.toContain("1 reviewed recap is ready");
    expect(html).toContain("Showing 12 of 25");
  });

  it("admin_view_has_no_employee_confirm_controls", () => {
    const html = render({
      initialTab: "recaps",
      initialRecap: FIXTURE_REVIEWED_RECAP,
      initialInbox: fixtureInboxPage({ count: 1, total: 1, nextCursor: null }),
    });
    expect(html).toContain("Corrected by employee");
    expect(html).toContain("Original recap");
    expect(html).toContain("Employee correction");
    expect(html).not.toMatch(/Looks right|Looks good|Add or correct|Clock in|Clock out|Confirm recap/);
    // A recap record uses the administration focus target, never a fake EOD
    // report id.
    expect(parseAdminRecordHref(`/work-os/admin/people/${FIXTURE_REVIEWED_RECAP.person.id}?recap=${FIXTURE_REVIEWED_RECAP.intervalId}`))
      .toEqual({
        section: "people",
        focus: { personId: FIXTURE_REVIEWED_RECAP.person.id, recapId: FIXTURE_REVIEWED_RECAP.intervalId },
      });
  });

  it("task results include names, inherited parent details and true page totals", () => {
    const opened: string[] = [];
    const html = renderToStaticMarkup(createElement(AdminResultCard, {
      result: fixtureTaskResult(),
      onOpenRecord: (url: string) => opened.push(url),
      onOpenRecap() {},
      onListen() {},
    }));
    expect(html).toContain("Synthetic Ada");
    expect(html).toContain("Subtask of Prepare the admin rollout");
    expect(html).not.toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(html).toContain("Showing 1 of 4");
    expect(html).toContain('href="/work-os/admin/tasks?task=99999999-9999-4999-8999-999999999999"');
    expect(opened).toHaveLength(0);
  });

  it("record results link only the server-generated same-app URL", () => {
    const html = renderToStaticMarkup(createElement(AdminResultCard, {
      result: fixtureRecordsResult(),
      onOpenRecord() {},
      onOpenRecap() {},
      onListen() {},
    }));
    expect(html).toContain(`href="/work-os/admin/people/${FIXTURE_REVIEWED_RECAP.person.id}?recap=${FIXTURE_REVIEWED_RECAP.intervalId}"`);
    expect(html).toContain("Reviewed the local preview.");
    expect(html).not.toContain("report=");
  });

  it("renders a model reply as text, never as a clickable URL", () => {
    const html = renderToStaticMarkup(createElement(AdminReplyText, {
      text: "See [the deployed app](https://example.invalid/evil) and javascript:alert(1).",
    }));
    expect(html).not.toContain("<a");
    expect(html).not.toContain('href="https://example.invalid');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("javascript:alert(1)");
  });

  it("new_arrival_does_not_steal_focus_or_scroll", () => {
    const surface = createAdminOttoSurfaceController();
    surface.selectTab("recaps");
    surface.openRecap("interval-1");
    const before = surface.snapshot();
    surface.receiveArrival({ count: 2, unread: 5 });
    const after = surface.snapshot();
    expect(after.tab).toBe("recaps");
    expect(after.selectedIntervalId).toBe("interval-1");
    expect(after.arrival.count).toBe(2);
    expect(after.arrival.unread).toBe(5);
    // No scroll request is produced, and no listening starts on arrival.
    expect(after.scrollRequest).toBe(before.scrollRequest);
    expect(after.listenRequest).toBe(before.listenRequest);
    expect(after.focusRequest).toBe(before.focusRequest);
  });

  it("starting_mic_stops_audio_and_vice_versa", () => {
    const stopSpeech = vi.fn();
    const stopMicrophone = vi.fn();
    const interlock = createAdminAudioInterlock({ stopSpeech, stopMicrophone });
    // A read starting cancels capture; a capture starting stops the read. The
    // two directions are independent, so neither can leave the other running.
    interlock.speechStarted();
    expect(stopMicrophone).toHaveBeenCalledTimes(1);
    expect(stopSpeech).not.toHaveBeenCalled();
    interlock.microphoneStarted();
    expect(stopSpeech).toHaveBeenCalledTimes(1);
    expect(stopMicrophone).toHaveBeenCalledTimes(1);
    // Simultaneous starts still resolve to the last explicit action; both
    // controllers run, and no player is left with a stale owner.
    stopSpeech.mockClear();
    stopMicrophone.mockClear();
    interlock.speechStarted();
    interlock.microphoneStarted();
    expect(stopMicrophone).toHaveBeenCalledTimes(1);
    expect(stopSpeech).toHaveBeenCalledTimes(1);
  });

  it("new_chat_clears_old_thread_and_draft_without_writing_it_back", async () => {
    const { createAdminOttoEntryController } = await import("./chatEntry");
    const controller = createAdminOttoEntryController({
      scope,
      send: async (input) => ({ conversationId: input.conversationId ?? "old-conversation", turnId: "old-turn", reply: "Old answer.", result: null, contextVersion: 1 }),
    });
    controller.setDraft("Old draft");
    await controller.submit();
    expect(controller.snapshot().conversationId).toBe("old-conversation");
    expect(controller.snapshot().turns).toHaveLength(2);
    const surface = createAdminOttoSurfaceController("chat");
    const conversationRef = { current: "old-conversation" as string | null };
    resetAdminOttoConversation({ controller, surface, conversationRef, scope });
    expect(controller.snapshot().conversationId).toBe(null);
    expect(controller.snapshot().turns).toEqual([]);
    expect(controller.snapshot().draft).toBe("");
    expect(conversationRef.current).toBe(null);
    expect(surface.snapshot().tab).toBe("chat");
    controller.dispose();
  });

  it("new_chat_ignores_the_stale_render_snapshot_and_never_reopens_the_old_thread", async () => {
    const { createAdminOttoEntryController } = await import("./chatEntry");
    const oldTurns = [
      { turnId: "old-user", role: "user" as const, text: "Old question", createdAt: "2026-10-27T10:00:00.000Z" },
      { turnId: "old-assistant", role: "assistant" as const, text: "Old answer", createdAt: "2026-10-27T10:00:01.000Z" },
    ];
    const recoveredTurns = [
      { turnId: "recovered-user", role: "user" as const, text: "Recovered question", createdAt: "2026-10-27T11:00:00.000Z" },
      { turnId: "recovered-assistant", role: "assistant" as const, text: "Recovered answer", createdAt: "2026-10-27T11:00:01.000Z" },
    ];
    const load = vi.fn(async (conversationId: string) => ({
      conversationId,
      contextVersion: 1,
      turns: conversationId === "old-conversation" ? oldTurns : recoveredTurns,
      result: null,
      resultStatus: "ready" as const,
    }));
    const controller = createAdminOttoEntryController({
      scope,
      load,
      send: async (input) => ({
        conversationId: input.conversationId ?? "new-after-reset",
        turnId: "new-after-reset-turn",
        reply: "New answer.",
        result: null,
        contextVersion: 1,
      }),
    });
    const conversationRef = { current: "old-conversation" as string | null };
    await controller.open("old-conversation");
    expect(controller.snapshot().turns.map((turn) => turn.text)).toEqual(["Old question", "Old answer"]);

    const surface = createAdminOttoSurfaceController("chat");
    const callbackIds: string[] = [];
    const firstInlineCallback = (conversationId: string) => callbackIds.push(conversationId);
    // Exact App render order: reset token effect, then the null conversation
    // prop effect, then the writeback effect with a stale render value and a
    // fresh inline callback identity.
    resetAdminOttoConversation({ controller, surface, conversationRef, scope });
    conversationRef.current = null;
    expect(syncAdminOttoConversation({
      controller,
      conversationRef,
      onConversation: firstInlineCallback,
      // This is the value the pre-reset render captured. The live controller
      // is now empty, so the stale render must not be written back.
      renderConversationId: "old-conversation",
    })).toBe(false);
    expect(callbackIds).toEqual([]);
    expect(controller.snapshot()).toMatchObject({ conversationId: null, turns: [], draft: "" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenLastCalledWith("old-conversation", expect.anything());
    expect(controller.snapshot().turns.some((turn) => turn.text === "Old question" || turn.text === "Old answer")).toBe(false);

    // A second App render with a new inline identity still cannot write back.
    expect(syncAdminOttoConversation({
      controller,
      conversationRef,
      onConversation: (conversationId) => callbackIds.push(conversationId),
    })).toBe(false);
    expect(callbackIds).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);

    // A legitimate known-conversation reload still hydrates its turns.
    conversationRef.current = "recovered-conversation";
    await controller.open("recovered-conversation");
    expect(load).toHaveBeenLastCalledWith("recovered-conversation", expect.anything());
    expect(controller.snapshot().turns.map((turn) => turn.text)).toEqual(["Recovered question", "Recovered answer"]);

    // A new conversation produced after reset is still reported once.
    await controller.open("recovered-conversation");
    conversationRef.current = null;
    controller.setDraft("New question");
    await controller.submit();
    expect(controller.snapshot().conversationId).toBe("recovered-conversation");
    expect(syncAdminOttoConversation({
      controller,
      conversationRef,
      onConversation: (conversationId) => callbackIds.push(conversationId),
    })).toBe(true);
    expect(callbackIds).toEqual(["recovered-conversation"]);
    controller.dispose();
  });

  it("preserves a known conversation and lets a failed send retry with the same request id", async () => {
    // The component uses the Task 8 controller, so this asserts the controller
    // contract the surface must not weaken: identity is bound before effects.
    const { createAdminOttoEntryController } = await import("./chatEntry");
    const requests: string[] = [];
    let reject: ((error: Error) => void) | undefined;
    const controller = createAdminOttoEntryController({
      scope,
      send: (input) => {
        requests.push(String(input.requestId));
        return new Promise((_, fail) => { reject = fail; });
      },
      initialConversationId: "known-conversation",
    });
    controller.setDraft("What is unfinished today?");
    const first = controller.submit();
    expect(controller.snapshot().conversationId).toBe("known-conversation");
    expect(controller.snapshot().busy).toBe(true);
    reject?.(new Error("Network unavailable."));
    await first;
    expect(controller.snapshot().draft).toBe("What is unfinished today?");
    expect(controller.recovery().requestId).toBe(requests[0]);
    controller.dispose();
  });
});
