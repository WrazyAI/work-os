import { describe, expect, it } from "vitest";
import { hasPendingMascotApproval } from "./mascotApproval";
import type { ProposedOperation, ToolCallResult } from "./interpretation";
const op: ProposedOperation = { op: "complete_task", taskId: "one", statement: "Complete one", proposalId: "proposal-one", enabled: true };
describe("mascot decision state", () => {
  it("waits only for unanswered mutations", () => {
    expect(hasPendingMascotApproval([op])).toBe(true);
    expect(hasPendingMascotApproval([{ ...op, enabled: false }])).toBe(false);
    expect(hasPendingMascotApproval([{ ...op, op: "display_pending_tasks" }])).toBe(false);
  });
  it.each(["recorded", "queued", "processing", "failed", "denied"] as ToolCallResult["status"][])("does not ask to approve a %s operation again", (status) => {
    expect(hasPendingMascotApproval([op], [{ op: { ...op }, status, message: "result" }])).toBe(false);
  });
  it("does not let another receipt consume a pending decision", () => {
    expect(hasPendingMascotApproval([op], [{ op: { ...op, proposalId: "other" }, status: "recorded", message: "done" }])).toBe(true);
  });
});
