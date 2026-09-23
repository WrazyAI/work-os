import type { WorkOsAccess } from "@/lib/work-os-api";
import { activeSession, shiftFor } from "@/lib/work-os-workday";
import { observeWorktivityAttendance } from "@/lib/work-os-attendance";
import { worktivityConfigured } from "@/lib/worktivity";
import { decideWorktivityAction, worktivityClockInContext, worktivityConfirmationRequirement, type WorktivityControlAction } from "@/modules/work-os/worktivity-control";

type ControlPhase = "preflight" | "confirm";

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

/** Server preflight and confirmation keep Worktivity as the attendance
 * authority. `confirm` always bypasses the observer cache and never clicks. */
export async function controlWorktivityAttendance(access: WorkOsAccess, input: unknown) {
  const body = record(input);
  const phase = body.phase as ControlPhase;
  const action = body.action as WorktivityControlAction;
  const operationId = typeof body.operation_id === "string" ? body.operation_id.trim() : "";
  if (!operationId || operationId.length > 160) throw new Error("A valid Worktivity operation_id is required.");
  if (phase !== "preflight" && phase !== "confirm") throw new Error("phase must be preflight or confirm.");
  if (!(["clock_in", "clock_out", "pause", "resume"] as string[]).includes(action)) throw new Error("A valid Worktivity attendance action is required.");
  if (!worktivityConfigured()) return { status: "blocked" as const, operation_id: operationId, message: "Worktivity is not configured for this workspace." };

  const now = new Date();
  const clockInContext = phase === "confirm" && action === "clock_in" ? worktivityClockInContext(body) : undefined;
  const observed = await observeWorktivityAttendance(access, now, {
    forceRefresh: true,
    ...(clockInContext ? { clockInContext } : {}),
  });
  const attendance = observed.attendance;
  if (attendance.source !== "worktivity" || attendance.stale || attendance.state === "unknown") {
    return { status: "blocked" as const, operation_id: operationId, message: attendance.message || "Worktivity did not return a fresh status." };
  }

  const decision = decideWorktivityAction(action, attendance.state);
  if (phase === "preflight") {
    if (decision.status === "blocked") return { ...decision, operation_id: operationId, attendance };
    if (decision.status === "already_target") return { status: "already_target" as const, operation_id: operationId, attendance };

    let scheduledStartsAt: string | null = null;
    let scheduledEndsAt: string | null = null;
    if (action === "clock_in") {
      const shift = await shiftFor(access, now, "startable");
      scheduledStartsAt = shift?.startsAt ?? null;
      scheduledEndsAt = shift?.endsAt ?? null;
    } else if (action === "clock_out") {
      const session = observed.session ?? await activeSession(access);
      scheduledEndsAt = typeof session?.scheduled_ends_at === "string" ? session.scheduled_ends_at : null;
    }
    const requirement = worktivityConfirmationRequirement({ action, now: now.toISOString(), scheduledStartsAt, scheduledEndsAt, body });
    if (requirement) return { status: "confirmation_required" as const, operation_id: operationId, requirement, attendance };
    return { status: "ready" as const, operation_id: operationId, attendance };
  }

  if (decision.status === "already_target") {
    return { status: "confirmed" as const, operation_id: operationId, state: attendance.state, attendance, session: observed.session };
  }
  if (decision.status === "ready") {
    return { status: "not_applied" as const, operation_id: operationId, state: attendance.state, attendance, message: "Worktivity still shows the previous attendance state. The change was not confirmed; you can retry it." };
  }
  return {
    status: "pending" as const,
    operation_id: operationId,
    state: attendance.state,
    attendance,
    message: decision.status === "blocked" ? decision.message : "Waiting for Worktivity to confirm the change.",
  };
}
