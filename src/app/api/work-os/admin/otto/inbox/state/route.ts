import { NextResponse } from "next/server";
import { requireAdminOttoAccess } from "@/lib/work-os-admin-otto-access";
import { updateAdminRecapDelivery } from "@/lib/work-os-admin-otto-inbox";
import { hasExpectedPublicOrigin } from "@/lib/request-origin";
import { jsonError } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["presented", "seen", "listened", "dismissed", "release"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function wired(response: NextResponse) {
  const body = await response.json().catch(() => ({}));
  return NextResponse.json({ schemaVersion: 1, ...body }, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Record presentation only after the caller's surface accepted it, or persist a
 * personal seen/listened/dismissed state. */
export async function PUT(req: Request) {
  try {
    const auth = await requireAdminOttoAccess(req);
    if (auth.response) return wired(auth.response);
    // Cookie-authenticated writes need the app origin; native desktop bearer
    // clients keep their existing CORS contract.
    if (!req.headers.get("authorization") && !hasExpectedPublicOrigin(req)) {
      return wired(NextResponse.json({ error: "invalid origin" }, { status: 403 }));
    }
    const parsed = await req.json().catch(() => null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return wired(badRequest("Body must be a JSON object"));
    }
    const body = parsed as Record<string, unknown>;
    if (typeof body.action !== "string" || !ACTIONS.has(body.action)) {
      return wired(badRequest("action must be presented, seen, listened, dismissed or release"));
    }
    if (!Array.isArray(body.eventIds) || body.eventIds.length < 1 || body.eventIds.length > 100
      || body.eventIds.some((id) => typeof id !== "string" || !UUID.test(id))) {
      return wired(badRequest("eventIds must contain between 1 and 100 delivery event ids"));
    }
    if (body.leaseToken !== undefined && typeof body.leaseToken !== "string") {
      return wired(badRequest("leaseToken must be a string"));
    }
    await updateAdminRecapDelivery(auth.access, {
      eventIds: body.eventIds as string[],
      action: body.action as "presented" | "seen" | "listened" | "dismissed" | "release",
      ...(body.leaseToken === undefined ? {} : { leaseToken: body.leaseToken as string }),
    });
    return NextResponse.json({ schemaVersion: 1, ok: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return wired(jsonError(error));
  }
}
