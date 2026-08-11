import { NextResponse } from "next/server";
import { listNiftyProjects, withNiftyOrganization } from "@/lib/integrations/nifty";
import { requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["subteam_id", "archived", "limit", "offset", "sort"]);

export async function GET(req: Request) {
  const auth = await requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), roles: ["admin"] });
  if (auth.response) return auth.response;

  const sp = new URL(req.url).searchParams;
  const params: Record<string, string> = {};
  for (const key of ALLOWED) {
    const value = sp.get(key);
    if (value) params[key] = value;
  }
  params.limit ??= "50";
  params.offset ??= "0";

  try {
    const data = await withNiftyOrganization(auth.access.organizationId, () => listNiftyProjects(params));
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
