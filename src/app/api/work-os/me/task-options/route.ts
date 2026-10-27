import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { getWorkOsTaskCreationOptions } from "@/lib/work-os-employee-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The people and projects an employee can attach to a task. Projects are
 * organization structure the employee already sees on every task row, so this
 * is an employee read, not an administration one. */
export async function GET(req: Request) {
  const auth = await requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    authorization: req.headers.get("authorization"),
    requirePerson: true,
    feature: "employee_companion",
  });
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await getWorkOsTaskCreationOptions(auth.access));
  } catch (error) {
    return jsonError(error);
  }
}
