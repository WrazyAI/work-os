import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess, workOsOrganizationOwnerId } from "@/lib/work-os-api";
import { listProjects } from "@/lib/work-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The organization's projects. Every task row already names its project, so
 * this is employee-visible structure rather than administration data. Anyone
 * in the workspace may read it; writes stay administration-only. */
export async function GET(req: Request) {
  const auth = await requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    authorization: req.headers.get("authorization"),
  });
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ projects: await listProjects(workOsOrganizationOwnerId(auth.access)) });
  } catch (err) {
    return jsonError(err);
  }
}
