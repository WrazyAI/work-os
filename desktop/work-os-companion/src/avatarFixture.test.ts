import { describe, expect, it } from "vitest";
import {
  AVATAR_RECORDED_FIXTURE, AVATAR_SHIFT_PROGRESS_FIXTURE, AVATAR_SNOOZE_FIXTURE, avatarFixtureChat, avatarFixtureFacts,
  avatarAttentionFixtureRequested, avatarFixtureRequested, avatarShiftProgressFixtureFacts, avatarShiftProgressFixtureRequested,
  avatarSnoozeFixtureFacts, avatarSnoozeFixtureRequested,
} from "./avatarFixture";

describe("avatar visual fixtures", () => {
  it("activates only for a supported fixture value", () => {
    expect(avatarFixtureRequested(`?window=avatar&avatar-fixture=${AVATAR_RECORDED_FIXTURE}`)).toBe(true);
    expect(avatarFixtureRequested(`?window=avatar&avatar-fixture=${AVATAR_SNOOZE_FIXTURE}`)).toBe(true);
    expect(avatarFixtureRequested("?window=avatar")).toBe(false);
    expect(avatarFixtureRequested("?window=avatar&avatar-fixture=other")).toBe(false);
    expect(avatarFixtureRequested("")).toBe(false);
  });

  it("provides an active due prompt for snooze reminder checks", () => {
    const facts = avatarSnoozeFixtureFacts(Date.parse("2026-09-23T12:00:00.000Z"));
    expect(facts).toMatchObject({
      promptRequired: true,
      promptKind: "hourly_fallback",
      sessionState: "active",
      clockedInAt: expect.any(String),
    });
    expect(avatarSnoozeFixtureRequested(`?window=avatar&avatar-fixture=${AVATAR_SNOOZE_FIXTURE}`)).toBe(true);
  });

  it("carries the production shapes the renderers must classify correctly", () => {
    const results = avatarFixtureChat().flatMap((turn) => turn.toolResults ?? []);
    const display = results.find((result) => Array.isArray((result.data as { provider_result?: { tasks?: unknown } })?.provider_result?.tasks));
    expect(display).toBeTruthy();
    const provider = (display!.data as { provider_result: { view: string; tasks: Array<{ id: string }> } }).provider_result;
    expect(provider.view).toBe("pending");
    expect(provider.tasks.map((task) => task.id)).toEqual(["fixture-new", "fixture-old"]);

    // The recorded mutation keeps the proposal row's provider_result object
    // (jsonb `{}`): the renderers must not treat it as a task view.
    const recorded = results.find((result) => result.op.op === "complete_task");
    expect(recorded?.status).toBe("recorded");
    expect((recorded!.data as { provider_result: unknown }).provider_result).toEqual({});
  });

  it("ships loaded facts with no session or agenda prompt", () => {
    const facts = avatarFixtureFacts();
    expect(facts.loaded).toBe(true);
    expect(facts.sessionState).toBeNull();
    expect(facts.taskOptions.map((task) => task.id)).toEqual(["fixture-new", "fixture-old"]);
  });

  it("provides a 90-minute elapsed session at half of its scheduled shift", () => {
    const now = Date.parse("2026-09-23T12:00:00Z");
    const facts = avatarShiftProgressFixtureFacts(now);
    const scheduledStart = Date.parse(facts.shiftStartsAt!);
    const scheduledEnd = Date.parse(facts.shiftEndsAt!);
    expect(avatarFixtureRequested(`?avatar-fixture=${AVATAR_SHIFT_PROGRESS_FIXTURE}`)).toBe(true);
    expect(avatarShiftProgressFixtureRequested(`?avatar-fixture=${AVATAR_SHIFT_PROGRESS_FIXTURE}`)).toBe(true);
    expect(facts.planStatus).toBe("confirmed");
    expect(now - Date.parse(facts.clockedInAt!)).toBe(90 * 60_000);
    expect((now - scheduledStart) / (scheduledEnd - scheduledStart)).toBe(0.5);
  });

  it("enables generic needs-input rendering only alongside a known avatar fixture", () => {
    expect(avatarAttentionFixtureRequested(`?avatar-fixture=${AVATAR_RECORDED_FIXTURE}&avatar-attention=true`)).toBe(true);
    expect(avatarAttentionFixtureRequested(`?avatar-fixture=${AVATAR_SHIFT_PROGRESS_FIXTURE}&avatar-attention=true`)).toBe(true);
    expect(avatarAttentionFixtureRequested("?avatar-fixture=unknown&avatar-attention=true")).toBe(false);
    expect(avatarAttentionFixtureRequested(`?avatar-fixture=${AVATAR_RECORDED_FIXTURE}`)).toBe(false);
  });
});
