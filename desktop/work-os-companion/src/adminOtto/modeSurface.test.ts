import { describe, expect, it } from "vitest";
import { clearAdminOttoSurface } from "./modeSurface";
import { createOttoModeController } from "./mode";

describe("admin Otto mode surface", () => {
  it("clears the entry and conversation through the shell's production seam", () => {
    expect(clearAdminOttoSurface()).toEqual({ entryOpen: false, conversationId: null });
  });
  it("retains a known conversation on context disposal but clears it on a deliberate workspace switch", async () => {
    const context = (mode: "admin" | "employee") => ({ scope: { userId: "user", organizationId: "org", mode }, personId: "person", voiceAvailable: false, transcriptionAvailable: false });
    let surface = { entryOpen: true, conversationId: "known-thread" as string | null };
    const create = () => createOttoModeController({ initialContext: context("admin"), employeeContext: context("employee"),
      clearResults: (_mode, reason) => { surface = clearAdminOttoSurface(reason, surface.conversationId); },
    });
    create().dispose();
    expect(surface).toEqual({ entryOpen: false, conversationId: "known-thread" });
    await create().switchMode("employee");
    expect(surface).toEqual({ entryOpen: false, conversationId: null });
  });
});
