import { describe, expect, it, vi } from "vitest";
import type { ChatResult, OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { suspendAdminOttoChat } from "./AdminOttoChat";
import { createAdminOttoEntryController } from "./chatEntry";

const scope: OttoScope = { userId: "user-1", organizationId: "org-1", mode: "admin" };

describe("admin Otto surface suspension", () => {
  it("suspend_captures_pending_recovery_before_unmount", async () => {
    let resolve!: (value: ChatResult) => void;
    const controller = createAdminOttoEntryController({
      scope,
      createRequestId: () => "request-1",
      send: () => new Promise((done) => { resolve = done; }),
    });
    controller.setDraft("keep this question");
    const pending = controller.submit();
    const cancel = vi.fn();
    const onRecoveryChange = vi.fn();
    const recovery = suspendAdminOttoChat({ controller, voice: { cancel }, onRecoveryChange });
    expect(recovery).toEqual({ draft: "keep this question", requestId: "request-1" });
    expect(cancel).toHaveBeenCalled();
    expect(onRecoveryChange).toHaveBeenCalledWith(recovery);
    resolve({ conversationId: "late", turnId: "late", reply: "late", result: null, contextVersion: 1 });
    await pending;
    expect(controller.snapshot()).toMatchObject({ conversationId: null, turns: [], draft: "keep this question", busy: false });
  });
});
