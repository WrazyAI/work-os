import { NextResponse } from "next/server";
import { createAgentToken, listAgentTokens } from "@/lib/work-agent-tokens";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = new Set(["name", "scopes", "expires_in_days"]);

async function access(req: Request) {
  return requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    authorization: req.headers.get("authorization"),
    requirePerson: true,
    feature: "employee_companion",
  });
}

/** Personal agent tokens: any active member mints for themselves, and nobody
 * sees or revokes a token they do not own. */
export async function GET(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    return NextResponse.json({ tokens: await listAgentTokens(auth.access) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "A token name is required" }, { status: 400 });
    }
    const unknown = Object.keys(body).find((key) => !ALLOWED_FIELDS.has(key));
    if (unknown) return NextResponse.json({ error: `Unknown field: ${unknown}` }, { status: 400 });
    const created = await createAgentToken(auth.access, {
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expires_in_days,
    });
    return NextResponse.json({ token: created.token, secret: created.secret }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
