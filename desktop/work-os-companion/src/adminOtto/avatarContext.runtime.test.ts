import { describe, expect, it } from "vitest";
import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { createAvatarContextController } from "./avatarContext";
import type { OttoContextEvent } from "./mode";
import { buildOttoViewState, type OttoViewState } from "./viewSwitch";

const first = { userId: "one", organizationId: "org", role: "admin" };
const scope: OttoScope = { userId: "one", organizationId: "org", mode: "admin" };
const context = (epoch = 5): OttoContextEvent => ({ scope, epoch });
const view = (patch: Partial<OttoViewState> = {}): OttoViewState => buildOttoViewState({
  scope,
  epoch: 5,
  revision: 1,
  workspace: "admin",
  role: "admin",
  adminStatus: "ready",
  personId: "person-1",
  voiceAvailable: true,
  transcriptionAvailable: false,
  adminConversationId: "conversation-1",
  adminConversationGeneration: 1,
  adminConversationRevision: 1,
  adminConversationBusy: false,
  ...patch,
});

describe("avatar view adoption", () => {
  it("same_epoch_new_revision_updates_capabilities_and_thread", async () => {
    const views: Array<OttoViewState | null> = [];
    let stops = 0;
    const controller = createAvatarContextController({
      onContext: () => undefined,
      onView: (next) => views.push(next),
      stopActiveWork: () => { stops += 1; },
    });
    await controller.sessionChanged(async () => first);
    controller.receiveView(view());
    controller.receiveView(view({
      revision: 2,
      voiceAvailable: false,
      transcriptionAvailable: true,
      adminConversationId: "conversation-2",
      adminConversationRevision: 2,
    }));
    expect(stops).toBe(0);
    expect(views.filter(Boolean)).toHaveLength(2);
    expect(views.at(-1)).toMatchObject({
      revision: 2,
      voiceAvailable: false,
      transcriptionAvailable: true,
      adminConversationId: "conversation-2",
    });
    expect(controller.isViewCurrent(views.at(-1)!)).toBe(true);
    expect(controller.isViewCurrent(views.filter(Boolean)[0]!)).toBe(false);
  });

  it("legacy_context_then_view_stops_once", async () => {
    const contexts: Array<OttoContextEvent | null> = [];
    const views: Array<OttoViewState | null> = [];
    let stops = 0;
    const controller = createAvatarContextController({
      onContext: (next) => contexts.push(next),
      onView: (next) => views.push(next),
      stopActiveWork: () => { stops += 1; },
    });
    await controller.sessionChanged(async () => first);
    controller.receiveView(view({ epoch: 5 }));
    controller.receive(context(6));
    controller.receiveView(view({ epoch: 6 }));
    expect(stops).toBe(1);
    expect(contexts.filter(Boolean)).toHaveLength(2);
    expect(views.at(-1)?.epoch).toBe(6);
  });

  it("view_queued_before_identity_is_validated_after_resolution", async () => {
    const views: Array<OttoViewState | null> = [];
    let resolveIdentity!: (value: typeof first) => void;
    const controller = createAvatarContextController({
      onContext: () => undefined,
      onView: (next) => views.push(next),
      stopActiveWork: () => undefined,
    });
    const pending = controller.sessionChanged(() => new Promise((resolve) => { resolveIdentity = resolve; }));
    controller.receiveView(view());
    resolveIdentity(first);
    await pending;
    expect(views.at(-1)?.epoch).toBe(5);
    expect(controller.view()?.scope).toEqual(scope);
  });

  it("token_replacement_fences_old_view_result", async () => {
    const views: Array<OttoViewState | null> = [];
    const controller = createAvatarContextController({
      onContext: () => undefined,
      onView: (next) => views.push(next),
      stopActiveWork: () => undefined,
    });
    await controller.sessionChanged(async () => first);
    controller.receiveView(view());
    let resolveOld!: (value: typeof first) => void;
    const old = controller.sessionChanged(() => new Promise((resolve) => { resolveOld = resolve; }));
    resolveOld(first);
    await old;
    controller.receiveView(view());
    expect(views.at(-1)).toBeNull();
    controller.receiveView(view({ epoch: 6, revision: 1 }));
    expect(views.at(-1)?.epoch).toBe(6);
  });

  it("same_actor_replacement_refuses_old_snapshot_before_new_owner_publish", async () => {
    const views: Array<OttoViewState | null> = [];
    const controller = createAvatarContextController({
      onContext: () => undefined,
      onView: (next) => views.push(next),
      stopActiveWork: () => undefined,
    });
    await controller.sessionChanged(async () => first);
    controller.receiveView(view({ epoch: 8 }));
    await controller.sessionChanged(async () => first);
    controller.receiveView(view({ epoch: 8 }));
    expect(views.at(-1)).toBeNull();
    controller.receiveView(view({ epoch: 9 }));
    expect(views.at(-1)?.epoch).toBe(9);
  });

  it("equal_heartbeat_is_idempotent_and_does_not_stop_audio", async () => {
    const views: Array<OttoViewState | null> = [];
    let stops = 0;
    const controller = createAvatarContextController({
      onContext: () => undefined,
      onView: (next) => views.push(next),
      stopActiveWork: () => { stops += 1; },
    });
    await controller.sessionChanged(async () => first);
    controller.receiveView(view());
    controller.receiveView(view());
    expect(stops).toBe(0);
    expect(views.filter(Boolean)).toHaveLength(1);
  });

  it("old_request_after_round_trip_is_stale", async () => {
    const controller = createAvatarContextController({
      onContext: () => undefined,
      onView: () => undefined,
      stopActiveWork: () => undefined,
    });
    await controller.sessionChanged(async () => first);
    const old = view({ epoch: 5 });
    controller.receiveView(old);
    controller.receiveView(view({ epoch: 6, workspace: "employee", scope: { ...scope, mode: "employee" } }));
    expect(controller.isViewCurrent(old)).toBe(false);
    expect(controller.isCurrent({ scope, epoch: 5 })).toBe(false);
  });

  it("new_account_can_start_at_epoch_one", async () => {
    const views: Array<OttoViewState | null> = [];
    const controller = createAvatarContextController({
      onContext: () => undefined,
      onView: (next) => views.push(next),
      stopActiveWork: () => undefined,
    });
    await controller.sessionChanged(async () => ({ userId: "two", organizationId: "org", role: "admin" }));
    controller.receiveView(view({ scope: { userId: "two", organizationId: "org", mode: "admin" }, epoch: 1 }));
    expect(views.at(-1)?.epoch).toBe(1);
  });

  it("foreign_and_same_epoch_mode_conflicts_are_ignored", async () => {
    const views: Array<OttoViewState | null> = [];
    const controller = createAvatarContextController({
      onContext: () => undefined,
      onView: (next) => views.push(next),
      stopActiveWork: () => undefined,
    });
    await controller.sessionChanged(async () => first);
    controller.receiveView(view({ scope: { userId: "other", organizationId: "org", mode: "admin" } }));
    controller.receiveView(view({ epoch: 5 }));
    controller.receiveView(view({ scope: { ...scope, mode: "employee" }, workspace: "employee" }));
    expect(views.filter(Boolean)).toHaveLength(1);
    expect(views.at(-1)?.scope.mode).toBe("admin");
  });

  it("clear_stops_work_and_clears_the_view", async () => {
    const views: Array<OttoViewState | null> = [];
    let stops = 0;
    const controller = createAvatarContextController({
      onContext: () => undefined,
      onView: (next) => views.push(next),
      stopActiveWork: () => { stops += 1; },
    });
    await controller.sessionChanged(async () => first);
    controller.receiveView(view());
    controller.clear();
    expect(stops).toBeGreaterThan(0);
    expect(views.at(-1)).toBeNull();
    expect(controller.view()).toBeNull();
  });
});

describe("avatar authoritative session lifecycle", () => {
  it("stops immediately on token replacement and fences delayed old identity/context", async () => {
    const contexts: Array<OttoContextEvent | null> = [];
    let stops = 0;
    const controller = createAvatarContextController({ onContext: (next) => contexts.push(next), stopActiveWork: () => { stops += 1; } });
    await controller.sessionChanged(async () => first);
    controller.receive(context());
    let resolveOld!: (value: typeof first) => void;
    const old = controller.sessionChanged(() => new Promise((done) => { resolveOld = done; }));
    expect(contexts.at(-1)).toBeNull();
    expect(stops).toBeGreaterThan(0);
    const next = controller.sessionChanged(async () => ({ ...first, userId: "two" }));
    controller.receive({ scope: { userId: "two", organizationId: "org", mode: "admin" }, epoch: 1 });
    await next;
    resolveOld(first); await old;
    controller.receive({ scope: { userId: "one", organizationId: "org", mode: "admin" }, epoch: 99 });
    expect(contexts.at(-1)).toEqual({ scope: { userId: "two", organizationId: "org", mode: "admin" }, epoch: 1 });
    controller.clear();
    controller.receive({ scope: { userId: "two", organizationId: "org", mode: "admin" }, epoch: 1 });
    expect(contexts.at(-1)).toBeNull();
  });

  it("does not adopt admin context for an authoritative employee session", async () => {
    let adopted: OttoContextEvent | null = null;
    const controller = createAvatarContextController({ onContext: (next) => { adopted = next; }, stopActiveWork: () => undefined });
    await controller.sessionChanged(async () => ({ ...first, role: "employee" }));
    controller.receive(context());
    expect(adopted).toBeNull();
  });
});
