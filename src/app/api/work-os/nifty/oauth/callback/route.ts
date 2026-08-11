import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeNiftyAuthorizationCode } from "@/lib/integrations/nifty";
import { requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, message: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:14px system-ui;margin:0;background:#f3f6f4;color:#1d2924}main{max-width:520px;margin:10vh auto;background:white;border:1px solid #ccd6d0;padding:28px}h1{font-size:22px}p{line-height:1.6;color:#5f6d66}a{color:#28624f;font-weight:600}</style></head><body><main><h1>${title}</h1><p>${message}</p><a href="/work-os">Return to Work OS</a></main></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return page("Nifty connection failed", "Nifty did not authorize this connection.", 400);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return page("Nifty connection failed", "The authorization response was incomplete.", 400);
  try {
    const db = createAdminClient();
    const { data: record, error } = await db.from("work_provider_oauth_states").select("*")
      .eq("provider", "nifty").eq("state_hash", createHash("sha256").update(state).digest("hex")).is("used_at", null).maybeSingle();
    if (error) throw error;
    if (!record || new Date(record.expires_at).getTime() <= Date.now()) return page("Nifty connection failed", "The authorization request expired or was already used.", 400);
    const auth = await requireWorkOsAccess({ organizationId: record.organization_id, roles: ["admin"] });
    if (auth.response) return page("Nifty connection failed", "This account cannot administer the requested organization.", 403);
    const { data: claimed, error: claimError } = await db.from("work_provider_oauth_states").update({ used_at: new Date().toISOString() }).eq("id", record.id).is("used_at", null).select("id").maybeSingle();
    if (claimError || !claimed) return page("Nifty connection failed", "The authorization request was already used.", 400);
    await exchangeNiftyAuthorizationCode(code, auth.access.organizationId, auth.access.ctx.user.id);
    await db.from("work_audit_log").insert({ organization_id: auth.access.organizationId, actor_user_id: auth.access.ctx.user.id, action: "nifty.connection_authorized", target_type: "provider_connection", target_id: "nifty" });
    return page("Nifty connected", "The organization credential was stored securely on the server.");
  } catch (error) {
    return page("Nifty connection failed", error instanceof Error ? error.message.replace(/[<>]/g, "") : "Token exchange failed.", 502);
  }
}
