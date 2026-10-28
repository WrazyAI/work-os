import { describe, expect, it } from "vitest";
import { PREVIEW_ADMIN_OTTO_TRANSPORT } from "./AdminPreview";

describe("administration preview New chat", () => {
  it("invokes a real local action instead of a no-op", async () => {
    const result = await PREVIEW_ADMIN_OTTO_TRANSPORT.send({ conversationId: null, requestId: "fixture", text: "What is open?" });
    expect(result.conversationId).toBe("admin-fixture-conversation");
    expect(result.reply).toContain("without contacting the workspace");
    expect(result.result?.kind).toBe("tasks");
  });
});
