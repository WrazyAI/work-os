import { NextResponse, after } from "next/server";
import { observeAttendanceChange } from "@/lib/work-os-attendance";
import { flushTimebotOutbox } from "@/lib/work-os-cosmos-timebot";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Interactive attendance check for the desktop companion and the employee
 * dashboard. It converges the active session from fresh Worktivity activity
 * (the same path a full day refresh takes) and reports whether the tracked
 * state moved, so clients can poll every 30-60s without refetching the whole
 * workspace and without stampeding the provider (reads are cached and
 * single-flight per employee). */
export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const refresh = new URL(req.url).searchParams.get("refresh");
    const result = await observeAttendanceChange(auth.access, new Date(), {
      forceRefresh: refresh === "1" || refresh === "true",
    });
    // The session just moved, so the #timebot line can go out now without
    // making the poll wait for Cosmos. `after` runs it once the response is
    // sent; the scheduled dispatch route is the safety net.
    if (result.changed) {
      after(async () => {
        try {
          await flushTimebotOutbox(5);
        } catch (error) {
          console.error("[work-os] timebot flush failed", {
            personId: auth.access.personId,
            message: error instanceof Error ? error.message : "unknown",
          });
        }
      });
    }
    return NextResponse.json({
      attendance: result.attendance,
      session: result.session,
      changed: result.changed,
    });
  } catch (error) {
    return jsonError(error);
  }
}
