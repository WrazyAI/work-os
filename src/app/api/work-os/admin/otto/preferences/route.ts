import { NextResponse } from "next/server";
import { requireAdminOttoAccess } from "@/lib/work-os-admin-otto-access";
import { getAdminOttoPreferences, saveAdminOttoPreferences } from "@/lib/work-os-admin-otto-preferences";
import { hasExpectedPublicOrigin } from "@/lib/request-origin";
import { jsonError } from "@/lib/work-os-api";
import type { FollowSettings } from "@/modules/work-os/admin-otto/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function settingsResponse(settings: FollowSettings) {
  return NextResponse.json({ schemaVersion: 1, ...settings }, {
    headers: { "Cache-Control": "no-store" },
  });
}

/** Re-wrap an access/error response so every preferences response carries the
 * shared wire envelope and no-store contract, including denials. */
async function wired(response: NextResponse) {
  const body = await response.json().catch(() => ({}));
  return NextResponse.json({ schemaVersion: 1, ...body }, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** GET is strictly a read: it never activates first use or writes a watermark. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOttoAccess(req);
    if (auth.response) return wired(auth.response);
    return settingsResponse(await getAdminOttoPreferences(auth.access));
  } catch (error) {
    return wired(jsonError(error));
  }
}

/** PUT is the explicit follow-settings save. The expected revision is compared
 * inside the clock-first transaction so another device cannot be overwritten. */
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
      return wired(NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 }));
    }
    const body = parsed as Record<string, unknown>;
    if (body.mode !== "all" && body.mode !== "selected") {
      return wired(NextResponse.json({ error: "mode must be all or selected" }, { status: 400 }));
    }
    if (!Array.isArray(body.personIds)) {
      return wired(NextResponse.json({ error: "personIds must be an array" }, { status: 400 }));
    }
    if (typeof body.expectedRevision !== "number") {
      return wired(NextResponse.json({ error: "expectedRevision must be a number" }, { status: 400 }));
    }
    const settings = await saveAdminOttoPreferences(auth.access, {
      mode: body.mode,
      personIds: body.personIds as string[],
      expectedRevision: body.expectedRevision,
    });
    return settingsResponse(settings);
  } catch (error) {
    return wired(jsonError(error));
  }
}
