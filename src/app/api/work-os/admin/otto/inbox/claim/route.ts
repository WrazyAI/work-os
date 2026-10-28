import { NextResponse } from "next/server";
import { requireAdminOttoAccess } from "@/lib/work-os-admin-otto-access";
import { claimAdminRecapDelivery } from "@/lib/work-os-admin-otto-inbox";
import { hasExpectedPublicOrigin } from "@/lib/request-origin";
import { jsonError } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/** Atomically lease up to 100 eligible arrivals for 30 seconds. */
export async function POST(req: Request) {
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
    if (typeof body.deviceId !== "string" || typeof body.windowId !== "string") {
      return wired(badRequest("deviceId and windowId are required"));
    }
    const deviceId = body.deviceId.trim();
    const windowId = body.windowId.trim();
    if (!deviceId || deviceId.length > 200 || !windowId || windowId.length > 200) {
      return wired(badRequest("deviceId and windowId must be between 1 and 200 characters"));
    }
    const lease = await claimAdminRecapDelivery(auth.access, { deviceId, windowId });
    return NextResponse.json({ schemaVersion: 1, lease }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return wired(jsonError(error));
  }
}
