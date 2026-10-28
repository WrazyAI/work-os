import { describe, expect, it, vi } from "vitest";
import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { isPersistedQueryKey, workOsKeys } from "../queryClient";
import { adminOttoKeys } from "./queryKeys";
import { createAdminOttoEntryController } from "./chatEntry";
import { onOttoAudioStop, requestOttoAudioStop } from "./audioOwner";
import { createRecapSpeechPlayer, type RecapAudio } from "../recapSpeechPlayer";
import type { ChatResult } from "../../../../src/modules/work-os/admin-otto/contracts";
import {
  OTTO_CONTEXT_EVENT,
  OTTO_CHANGED_EVENT,
  adminOttoChangedEvent,
  captureScopeStillCurrent,
  createOttoModeController,
  ottoContextEvent,
  parseOttoContextEvent,
  sameOttoScope,
  type AdminOttoContext,
  type OttoModeControllerDeps,
  type OttoModeSnapshot,
} from "./mode";

const actor = { userId: "user-1", organizationId: "org-1" };

function context(mode: "admin" | "employee", personId: string | null): AdminOttoContext {
  return {
    scope: { ...actor, mode },
    personId,
    voiceAvailable: mode === "admin",
    transcriptionAvailable: true,
  };
}

function harness(patch: Partial<OttoModeControllerDeps> = {}) {
  const aborted: Array<{ epoch: number; reason: string }> = [];
  const published: OttoModeSnapshot[] = [];
  const cleared: string[] = [];
  const stops = { audio: 0, microphone: 0 };
  const controller = createOttoModeController({
    initialContext: context("admin", null),
    adminContext: context("admin", null),
    employeeContext: context("employee", "person-1"),
    abort: (epoch, reason) => aborted.push({ epoch, reason }),
    stopAudio: () => { stops.audio += 1; },
    stopMicrophone: () => { stops.microphone += 1; },
    clearResults: (mode) => cleared.push(mode),
    publish: (snapshot) => published.push(snapshot),
    ...patch,
  });
  return { controller, aborted, published, cleared, stops };
}

describe("admin Otto mode controller", () => {
  it("can resume above the last published epoch after context recovery", () => {
    const controller = harness({ initialEpoch: 8 }).controller;
    expect(controller.snapshot().epoch).toBe(8);
    expect(controller.isCurrent(1)).toBe(false);
    controller.dispose();
  });
  it("admin_keys_never_persist", () => {
    const adminScope: OttoScope = { ...actor, mode: "admin" };
    const employeeScope: OttoScope = { ...actor, mode: "employee" };
    for (const scope of [adminScope, employeeScope]) {
      const keys = adminOttoKeys(scope);
      expect(keys.context.slice(0, 5)).toEqual(["work-os", "admin", "otto", "org-1", "user-1"]);
      expect(keys.inbox("cursor-1").slice(0, 5)).toEqual(["work-os", "admin", "otto", "org-1", "user-1"]);
      expect(keys.preferences.slice(0, 5)).toEqual(["work-os", "admin", "otto", "org-1", "user-1"]);
      expect(keys.people().slice(0, 6)).toEqual(["work-os", "admin", "otto", "org-1", "user-1", "people"]);
      expect(keys.peopleRoot.slice(0, 6)).toEqual(["work-os", "admin", "otto", "org-1", "user-1", "people"]);
      expect(keys.inboxRoot.slice(0, 6)).toEqual(["work-os", "admin", "otto", "org-1", "user-1", "inbox"]);
      for (const key of [keys.context, keys.inbox(), keys.inboxRoot, keys.people(), keys.peopleRoot, keys.preferences, keys.chat(null), keys.recap("interval-1")]) {
        expect(isPersistedQueryKey(key)).toBe(false);
        expect(JSON.stringify(key)).not.toContain("vault");
        expect(JSON.stringify(key)).not.toContain("conversation");
      }
    }
    // The employee cache roots remain persisted; only the admin Otto subtree is excluded.
    expect(isPersistedQueryKey(workOsKeys.day("compact"))).toBe(true);
  });

  it("mode_switch_aborts_and_clears_old_results", async () => {
    const h = harness();
    expect(h.controller.snapshot()).toMatchObject({ scope: { ...actor, mode: "admin" }, epoch: 1 });

    const next = await h.controller.switchMode("employee");
    expect(next.scope.mode).toBe("employee");
    expect(next.personId).toBe("person-1");
    expect(next.epoch).toBe(2);
    // The old scope's in-flight work is fenced before its state is cleared.
    expect(h.aborted).toEqual([{ epoch: 1, reason: "mode_switch" }]);
    expect(h.stops).toEqual({ audio: 1, microphone: 1 });
    expect(h.cleared).toEqual(["admin"]);
    expect(h.published.at(-1)?.epoch).toBe(2);
    expect(h.controller.isCurrent(1)).toBe(false);
    expect(h.controller.isCurrent(2)).toBe(true);
  });

  it("plain minimize or expand in the same scope does not abort or clear", async () => {
    const h = harness();
    const next = await h.controller.switchMode("admin");
    expect(next.epoch).toBe(1);
    expect(h.aborted).toEqual([]);
    expect(h.stops).toEqual({ audio: 0, microphone: 0 });
    expect(h.cleared).toEqual([]);
    expect(h.published).toEqual([]);
  });

  it("unmapped_admin_can_switch_back_to_admin_without_a_person_mapping", async () => {
    const h = harness({
      initialContext: context("employee", "person-1"),
      employeeContext: context("employee", "person-1"),
      adminContext: context("admin", null),
    });
    const restored = await h.controller.switchMode("admin");
    expect(restored.scope.mode).toBe("admin");
    expect(restored.personId).toBeNull();
  });

  it("refuses an employee scope the account does not have", async () => {
    const h = harness({ employeeContext: null });
    await expect(h.controller.switchMode("employee")).rejects.toMatchObject({ reason: "employee_context_unavailable" });
    expect(h.controller.snapshot()).toMatchObject({ scope: { mode: "admin" }, epoch: 1 });
    expect(h.aborted).toEqual([]);
  });

  it("two_windows_share_context_epoch", async () => {
    const main = harness();
    const avatar = harness({ publish: undefined });
    await main.controller.switchMode("employee");
    const event = ottoContextEvent(main.controller.snapshot());
    expect(event).toEqual({
      scope: { ...actor, mode: "employee" },
      epoch: 2,
    });
    // The published event carries no person record, voice flag, token, or result.
    expect(JSON.stringify(event)).not.toContain("person-1");
    expect(Object.keys(event).sort()).toEqual(["epoch", "scope"]);

    expect(avatar.controller.adoptEvent(event)).toBe(true);
    expect(avatar.controller.snapshot()).toMatchObject({ scope: { ...actor, mode: "employee" }, epoch: 2 });
    // A late, older broadcast cannot rewind the shared epoch.
    expect(avatar.controller.adoptEvent(ottoContextEvent({ ...main.controller.snapshot(), epoch: 1 }))).toBe(false);
    expect(avatar.controller.snapshot().epoch).toBe(2);

    const parsed = parseOttoContextEvent({ ...event, personId: "leak", token: "secret" });
    expect(parsed).toEqual({ scope: event.scope, epoch: 2 });
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });

  it("cross_account_stale_response_ignored", async () => {
    let resolve!: (result: ChatResult) => void;
    const entry = createAdminOttoEntryController({ scope: { ...actor, mode: "admin" },
      send: () => new Promise((done) => { resolve = done; }), createRequestId: () => "request",
    });
    const h = harness({ abort: () => entry.cancel() });
    entry.setDraft("old question");
    const pending = entry.submit();
    await h.controller.switchMode("employee");
    entry.reset({ userId: "other-user", organizationId: "org-1", mode: "admin" });
    resolve({ conversationId: "old", turnId: "late", reply: "wrong account", result: null, contextVersion: 1 });
    await pending;
    expect(entry.snapshot().turns).toEqual([]);
    expect(entry.snapshot().conversationId).toBeNull();

    // A broadcast for another account/organization is rejected too.
    const foreign = {
      scope: { userId: "other-user", organizationId: "org-1", mode: "employee" as const },
      epoch: 9,
    };
    expect(h.controller.adoptEvent(foreign)).toBe(false);
    expect(h.controller.snapshot().epoch).toBe(2);
    expect(OTTO_CONTEXT_EVENT).toBe("work-os://otto-context-changed");
    expect(OTTO_CHANGED_EVENT).toBe("work-os://admin-otto-changed");
  });

  it("stops actual recap playback on mode/account boundaries but not same-scope expansion", async () => {
    const pause = vi.fn();
    const audio: RecapAudio = { currentTime: 0, duration: 10, load: async () => undefined,
      play: async () => undefined, pause, addEventListener: () => undefined };
    const player = createRecapSpeechPlayer({
      fetchClip: async () => ({ bytes: new ArrayBuffer(1), mimeType: "audio/wav", lines: [], revision: 1, stale: false }),
      createAudio: () => audio, onSnapshot: () => undefined, onFailure: () => undefined, onStaleCard: () => undefined,
    });
    const off = onOttoAudioStop(() => player.stop());
    const h = harness({ stopAudio: requestOttoAudioStop });
    await player.toggle({ intervalId: "interval", revision: 1, voice: "Kore", enabled: true });
    expect(player.snapshot().status).toBe("playing");
    await h.controller.switchMode("admin");
    expect(player.snapshot().status).toBe("playing");
    await h.controller.switchMode("employee");
    expect(player.snapshot().status).toBe("idle");
    expect(pause).toHaveBeenCalled();
    await player.toggle({ intervalId: "interval", revision: 1, voice: "Kore", enabled: true });
    h.controller.dispose();
    expect(player.snapshot().status).toBe("idle");
    off(); player.dispose();
  });

  it("clears a removed employee mapping instead of keeping a stale switch target", async () => {
    const h = harness();
    h.controller.setContexts({ employeeContext: null });
    await expect(h.controller.switchMode("employee")).rejects.toMatchObject({ reason: "employee_context_unavailable" });
    h.controller.setContexts({ adminContext: null });
    expect(h.controller.snapshot().personId).toBeNull();
    expect(h.controller.snapshot().voiceAvailable).toBe(false);
  });

  it("a plain employee capture is fenced by the session without an admin controller", () => {
    const requested: OttoScope = { ...actor, mode: "employee" };
    expect(captureScopeStillCurrent({
      requested,
      requestedEpoch: 1,
      actor,
      session: actor,
      mode: null,
    })).toBe(true);
    // A late grant after the account switched must not open a microphone.
    expect(captureScopeStillCurrent({
      requested,
      requestedEpoch: 1,
      actor,
      session: { userId: "user-2", organizationId: "org-1" },
      mode: null,
    })).toBe(false);
    expect(captureScopeStillCurrent({
      requested,
      requestedEpoch: 1,
      actor,
      session: null,
      mode: null,
    })).toBe(false);
    // An administrative controller contributes its own epoch/mode fence.
    expect(captureScopeStillCurrent({
      requested,
      requestedEpoch: 4,
      actor,
      session: actor,
      mode: { scope: requested, epoch: 4 },
    })).toBe(true);
    expect(captureScopeStillCurrent({
      requested,
      requestedEpoch: 4,
      actor,
      session: actor,
      mode: { scope: requested, epoch: 5 },
    })).toBe(false);
    expect(captureScopeStillCurrent({
      requested,
      requestedEpoch: 4,
      actor,
      session: actor,
      mode: { scope: { ...actor, mode: "admin" }, epoch: 4 },
    })).toBe(false);
  });

  it("scope equality fences a late actor/org/mode callback", () => {
    const scope: OttoScope = { ...actor, mode: "admin" };
    expect(sameOttoScope(scope, { ...scope })).toBe(true);
    expect(sameOttoScope(scope, { ...scope, userId: "other" })).toBe(false);
    expect(sameOttoScope(scope, { ...scope, organizationId: "other" })).toBe(false);
    expect(sameOttoScope(scope, { ...scope, mode: "employee" })).toBe(false);
    expect(sameOttoScope(null, scope)).toBe(false);
    expect(sameOttoScope(scope, null)).toBe(false);
  });

  it("admin_otto_changed_events_carry_ids_not_team_records_or_tokens", async () => {
    const event = adminOttoChangedEvent({
      scope: { ...actor, mode: "admin" },
      epoch: 3,
      eventIds: ["event-1", "event-2"],
      conversationId: "conversation-1",
      leaseToken: "lease-token",
      recap: { headline: "secret team text" },
    } as never);
    expect(event).toEqual({
      scope: { ...actor, mode: "admin" },
      epoch: 3,
      eventIds: ["event-1", "event-2"],
      conversationId: "conversation-1",
    });
    expect(JSON.stringify(event)).not.toContain("lease-token");
    expect(JSON.stringify(event)).not.toContain("secret team text");
  });
});
