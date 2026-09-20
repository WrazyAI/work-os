from pathlib import Path
import sys
root=Path(sys.argv[1]); src=root/'desktop/work-os-companion/src'
p=src/'scenarios.ts'; s=p.read_text(); lines=s.splitlines(True)
new=[line for line in lines if line.startswith('  { id: "mascot_')]
assert len(new)==5
s=''.join(line for line in lines if line not in new)
start=s.index('export const DEBUG_PRESETS:'); end=s.index('\n];',start)
s=s[:end]+'\n'+''.join(new).rstrip('\n')+s[end:]; p.write_text(s)
p=root/'test/work-os-companion-mascot.test.mts';s=p.read_text()
s=s.replace('assert.match(mascotPet, /const visual = deriveMascotVisualState/);','assert.match(mascotPet, /deriveMascotVisualState/);')
p.write_text(s)
p=src/'mascot-runtime.css';p.write_text(p.read_text()+'\n.avatar-orb:has(.mascot-pet[data-reduced-motion="true"]) { animation: none !important; transition: none !important; }\n')
(src/'mascotApproval.ts').write_text('''import { isMutatingToolOp, type ProposedOperation, type ToolCallResult } from "./interpretation";

/** A receipt (including queued/denied/failed) has already consumed its decision.
 * Keep only genuinely unanswered mutations in the needs-input state. */
export function hasPendingMascotApproval(operations: readonly ProposedOperation[] = [], results: readonly ToolCallResult[] = []): boolean {
  return operations.some((op) => op.enabled && isMutatingToolOp(op) && !results.some((result) =>
    result.op === op || (op.proposalId ? result.op.proposalId === op.proposalId :
      result.op.op === op.op && result.op.taskId === op.taskId && result.op.statement === op.statement)));
}
''')
for name in ['App.tsx','AvatarApp.tsx']:
 p=src/name;s=p.read_text();s='import { hasPendingMascotApproval } from "./mascotApproval";\n'+s
 if name=='App.tsx':
  s=s.replace('interpretation.operations.some((op) => op.enabled && isMutatingToolOp(op))','hasPendingMascotApproval(interpretation.operations, interpretation.results)')
  s=s.replace('|| completingTaskIds.size > 0 || pendingTasks.some', '|| !!interpretation?.results?.some((result) => result.status === "processing")\n      || completingTaskIds.size > 0 || pendingTasks.some')
 else:
  s=s.replace('!!lastEntry?.operations?.some((op) => op.enabled && isMutatingToolOp(op))','hasPendingMascotApproval(lastEntry?.operations, lastEntry?.toolResults)')
  s=s.replace('    working: thinking || filing,','    working: thinking || filing || !!lastEntry?.toolResults?.some((result) => result.status === "processing"),')
 p.write_text(s)
(src/'mascotApproval.test.ts').write_text('''import { describe, expect, it } from "vitest";
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
''')
print('Finished compatibility and approval state adjustments.')
