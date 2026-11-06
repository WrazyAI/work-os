import { describe, expect, it } from "vitest";
import { avatarViewFixtureRequested, createAvatarViewFixture } from "./viewFixture";

describe("avatar admin view fixture", () => {
  it("avatar_admin_fixture_is_dev_only_and_token_free", () => {
    expect(avatarViewFixtureRequested("?window=avatar&avatar-view=admin")).toBe(true);
    expect(avatarViewFixtureRequested("?window=avatar&avatar-view=employee")).toBe(false);
    expect(createAvatarViewFixture("?avatar-view=admin&token=old").initial.scope.userId).toBe("user-preview");
  });

  it("drives availability and local switch/refusal through the shared rules", async () => {
    const fixture = createAvatarViewFixture("?avatar-view=admin&view-state=unmapped");
    expect(fixture.initial.workspace).toBe("admin");
    expect(fixture.initial.employeeAvailable).toBe(false);
    await expect(fixture.request("employee")).resolves.toEqual({ ok: false, reason: "employee_unavailable" });
    const failed = createAvatarViewFixture("?avatar-view=admin&view-state=failed");
    expect(failed.initial.adminAvailable).toBe(false);
    await expect(failed.request("employee")).resolves.toEqual({ ok: false, reason: "employee_unavailable" });
    expect(failed.retry()).toMatchObject({ adminStatus: "ready", adminAvailable: true });
  });
});
