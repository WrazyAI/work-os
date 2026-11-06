import { describe, expect, it } from "vitest";
import { ADMIN_FIXTURE_TRANSPORT } from "./fixtures";

describe("admin fixture conversation history", () => {
  it("keeps synthetic turns for a remount and clears them on New chat", async () => {
    await ADMIN_FIXTURE_TRANSPORT.discard({ conversationId: null, requestId: null });
    const sent = await ADMIN_FIXTURE_TRANSPORT.send({ conversationId: null, text: "history fixture" });
    const loaded = await ADMIN_FIXTURE_TRANSPORT.load(sent.conversationId);

    expect(loaded.turns.map((turn) => [turn.role, turn.text])).toEqual([
      ["user", "history fixture"],
      ["assistant", sent.reply],
    ]);
    for (const turn of loaded.turns) {
      expect(turn.createdAt).toBeTruthy();
      expect(Number.isNaN(new Date(turn.createdAt).getTime())).toBe(false);
    }
    expect(loaded.result).toMatchObject({ kind: "tasks" });
    expect(loaded.resultStatus).toBe("ready");

    await ADMIN_FIXTURE_TRANSPORT.discard({ conversationId: sent.conversationId, requestId: null });
    expect((await ADMIN_FIXTURE_TRANSPORT.load(sent.conversationId)).turns).toEqual([]);
  });
});
