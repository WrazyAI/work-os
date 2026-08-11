import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { niftyRedirectUri } from "@/lib/integrations/nifty";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), roles: ["admin"] });
    if (auth.response) return auth.response;
    const authorizeUrl = process.env.NIFTY_AUTHORIZE_URL?.trim();
    const clientId = process.env.NIFTY_CLIENT_ID?.trim();
    const redirectUri = niftyRedirectUri();
    if (!authorizeUrl || !redirectUri || !clientId) return NextResponse.json({ error: "Nifty OAuth is not configured" }, { status: 503 });
    const state = randomBytes(32).toString("base64url");
    const { error } = await createAdminClient().from("work_provider_oauth_states").insert({
      organization_id: auth.access.organizationId, provider: "nifty", state_hash: createHash("sha256").update(state).digest("hex"),
      redirect_uri: redirectUri, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), created_by: auth.access.ctx.user.id,
    });
    if (error) throw new Error(`create Nifty OAuth state: ${error.message}`);
    const target = new URL(authorizeUrl);
    target.searchParams.set("client_id", clientId);
    target.searchParams.set("response_type", "code");
    target.searchParams.set("state", state);
    target.searchParams.set("redirect_uri", redirectUri);
    if (process.env.NIFTY_OAUTH_SCOPE?.trim()) target.searchParams.set("scope", process.env.NIFTY_OAUTH_SCOPE.trim());
    return NextResponse.redirect(target);
  } catch (error) { return jsonError(error); }
}
