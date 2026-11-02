import { NextResponse } from "next/server";
import { adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { listAdminAgentTasks, parseAdminAgentTaskFilters } from "@/lib/work-admin-agent-tasks";
import { employeeTaskToday } from "@/lib/work-os-employee-tasks";
import { withTaskCapabilities } from "@/lib/work-os-task-capabilities";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cross-person task search. An absent `person_ids` reads the whole
 * organization; an empty one is an explicit empty result. Status defaults to
 * active so archived and tombstoned rows stay out unless asked for. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminAgentAccess(req, "tasks:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const filters = parseAdminAgentTaskFilters(new URL(req.url).searchParams);
    // Resolve the admin's local day once: the overdue filter and the capability
    // decoration must agree on the same calendar day.
    const today = await employeeTaskToday(auth.agent.access);
    const page = await listAdminAgentTasks(auth.agent.access, filters, { today });
    // Capabilities are computed for the admin's own person so an unmapped admin
    // still sees the flags their role grants, and a person-mapped admin sees
    // the same assignment flags the dashboard shows.
    const tasks = withTaskCapabilities(
      page.tasks as Array<Record<string, any>>,
      { role: "admin", personId: auth.agent.access.personId },
      today,
    );
    return NextResponse.json({
      tasks,
      total: page.total,
      cursor: { next: page.nextCursor },
    });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
