import { NextResponse } from "next/server";
import { listNiftyMembers, withNiftyOrganization } from "@/lib/integrations/nifty";
import { requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cache = new Map<string, { ts: number; body: unknown }>();
const TTL = 60_000;

export async function GET(req: Request) {
  const auth = await requireWorkOsAccess({ authorization: req.headers.get("authorization"), organizationId: req.headers.get("x-work-os-organization-id"), roles: ["admin"] });
  if (auth.response) return auth.response;

  const cached = cache.get(auth.access.organizationId);
  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json(cached.body, { headers: { "X-Nifty-Cache": "hit" } });
  }

  try {
    const body = await withNiftyOrganization(auth.access.organizationId, () => listNiftyMembers());
    cache.set(auth.access.organizationId, { ts: Date.now(), body });
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
