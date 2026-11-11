import { describe, expect, it } from "vitest";
import type { OttoContextEvent } from "./mode";
import { adoptAvatarContext, adoptAvatarView, avatarIdentityChanged } from "./avatarContext";
import { buildOttoViewState, type OttoViewState } from "./viewSwitch";

const identity = { userId: "user-1", organizationId: "org-1" };
const event = (patch: Partial<OttoContextEvent> = {}): OttoContextEvent => ({
  scope: { userId: "user-1", organizationId: "org-1", mode: "admin" },
  epoch: 2,
  ...patch,
});

describe("avatar context adoption", () => {
  it("adopts the shared epoch for the same account", () => {
    expect(adoptAvatarContext(null, event(), identity)).toMatchObject({
      adopt: true,
      stopActiveWork: false,
      accountChanged: false,
    });
  });

  it("ignores an older epoch and a foreign account", () => {
    expect(adoptAvatarContext(event({ epoch: 3 }), event({ epoch: 2 }), identity)).toBeNull();
    expect(adoptAvatarContext(null, event({
      scope: { userId: "user-2", organizationId: "org-1", mode: "admin" },
    }), identity)).toBeNull();
    expect(adoptAvatarContext(null, event({
      scope: { userId: "user-1", organizationId: "org-2", mode: "admin" },
    }), identity)).toBeNull();
    expect(adoptAvatarContext(event(), event(), null)).toBeNull();
  });

  it("treats a same-organization new user at epoch 1 as a hard boundary", () => {
    const current = event({ epoch: 5 });
    const next = event({
      epoch: 1,
      scope: { userId: "user-2", organizationId: "org-1", mode: "admin" },
    });
    expect(adoptAvatarContext(current, next, { userId: "user-2", organizationId: "org-1" })).toMatchObject({
      adopt: true,
      stopActiveWork: true,
      accountChanged: true,
      epochChanged: true,
    });
  });

  it("stops old audio/mic/network on a mode or epoch change", () => {
    expect(adoptAvatarContext(event(), event({ epoch: 3 }), identity)).toMatchObject({
      adopt: true,
      stopActiveWork: true,
      accountChanged: false,
    });
    expect(adoptAvatarContext(event(), event({
      epoch: 3,
      scope: { userId: "user-1", organizationId: "org-1", mode: "employee" },
    }), identity)).toMatchObject({ adopt: true, stopActiveWork: true, modeChanged: true });
  });

  it("resets on a sign-out or identity change, not only an organization change", () => {
    expect(avatarIdentityChanged(event(), identity, null)).toBe(true);
    expect(avatarIdentityChanged(event(), identity, { ...identity, userId: "user-2" })).toBe(true);
    expect(avatarIdentityChanged(event(), identity, identity)).toBe(false);
    expect(avatarIdentityChanged(null, identity, identity)).toBe(false);
  });
});

const view = (patch: Partial<OttoViewState> = {}): OttoViewState => buildOttoViewState({
  scope: { userId: "user-1", organizationId: "org-1", mode: "admin" },
  epoch: 2,
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

describe("avatar full view adoption", () => {
  it("accepts only a newer revision or epoch and rejects a same-epoch mode conflict", () => {
    const current = view();
    expect(adoptAvatarView(current, view({ revision: 1 }), identity)).toBeNull();
    expect(adoptAvatarView(current, view({ revision: 2 }), identity)).toMatchObject({
      adopt: true, stopActiveWork: false, revisionChanged: true,
    });
    expect(adoptAvatarView(current, view({ epoch: 3 }), identity)).toMatchObject({
      adopt: true, stopActiveWork: true, epochChanged: true,
    });
    expect(adoptAvatarView(current, view({ epoch: 2, scope: { ...current.scope, mode: "employee" }, workspace: "employee" }), identity)).toBeNull();
    expect(adoptAvatarView(current, view({ scope: { userId: "other", organizationId: "org-1", mode: "admin" } }), identity)).toBeNull();
    expect(adoptAvatarView(current, view({ revision: 3, adminConversationGeneration: 0 }), identity)).toBeNull();
    expect(adoptAvatarView(current, view({ revision: 3, adminConversationGeneration: 1, adminConversationRevision: 0 }), identity)).toBeNull();
  });
});
