import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkOsAccess } from "@/lib/work-os-api";

const REDIRECT_URI = "wrazy-workos://auth";
const CODE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function base64UrlSha256(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validOpaque(value: unknown, min: number, max: number) {
  return typeof value === "string" && value.length >= min && value.length <= max && /^[A-Za-z0-9._~-]+$/.test(value);
}

export async function authorizeDesktop(access: WorkOsAccess, body: Record<string, unknown>) {
  if (!validOpaque(body.challenge, 43, 128)) throw new Error("valid PKCE challenge is required");
  if (!validOpaque(body.state, 16, 160)) throw new Error("valid state is required");
  if (body.redirect_uri !== REDIRECT_URI) throw new Error("unsupported desktop redirect URI");
  const rawCode = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("work_desktop_auth_codes").insert({
    organization_id: access.organizationId,
    user_id: access.ctx.user.id,
    code_hash: sha256(rawCode),
    pkce_challenge: body.challenge,
    state: body.state,
    redirect_uri: REDIRECT_URI,
    expires_at: expiresAt,
  }).select("id").single();
  if (error) throw new Error(`create desktop authorization: ${error.message}`);
  await supabase.from("work_audit_log").insert({
    organization_id: access.organizationId,
    actor_user_id: access.ctx.user.id,
    action: "desktop.authorization_approved",
    target_type: "desktop_auth_code",
    target_id: data.id,
  });
  const callback = new URL(REDIRECT_URI);
  callback.searchParams.set("code", rawCode);
  callback.searchParams.set("state", body.state as string);
  return { callbackUrl: callback.toString(), expiresAt };
}

export async function exchangeDesktopCode(body: Record<string, unknown>) {
  if (!validOpaque(body.code, 32, 128)) throw new Error("authorization code is required");
  if (!validOpaque(body.verifier, 43, 128)) throw new Error("valid PKCE verifier is required");
  const deviceName = typeof body.device_name === "string" ? body.device_name.trim().slice(0, 120) : "Work OS Companion";
  const supabase = createAdminClient();
  const { data: code, error } = await supabase.from("work_desktop_auth_codes")
    .select("id, organization_id, user_id, pkce_challenge, expires_at, used_at")
    .eq("code_hash", sha256(body.code as string))
    .maybeSingle();
  if (error) throw new Error(`load desktop authorization: ${error.message}`);
  if (!code || code.used_at || new Date(code.expires_at as string).getTime() <= Date.now()) {
    throw new Error("authorization code is invalid or expired");
  }
  if (!secureEqual(base64UrlSha256(body.verifier as string), code.pkce_challenge as string)) {
    throw new Error("PKCE verification failed");
  }
  const usedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase.from("work_desktop_auth_codes")
    .update({ used_at: usedAt })
    .eq("id", code.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(`claim desktop authorization: ${claimError.message}`);
  if (!claimed) throw new Error("authorization code was already used");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { data: session, error: sessionError } = await supabase.from("work_desktop_sessions").insert({
    organization_id: code.organization_id,
    user_id: code.user_id,
    token_hash: sha256(token),
    device_name: deviceName || "Work OS Companion",
    expires_at: expiresAt,
  }).select("id").single();
  if (sessionError) throw new Error(`create desktop session: ${sessionError.message}`);
  await supabase.from("work_audit_log").insert({
    organization_id: code.organization_id,
    actor_user_id: code.user_id,
    action: "desktop.session_created",
    target_type: "desktop_session",
    target_id: session.id,
    metadata: { device_name: deviceName || "Work OS Companion" },
  });
  return { access_token: token, token_type: "Bearer", expires_at: expiresAt, organization_id: code.organization_id };
}

export async function revokeDesktopSession(access: WorkOsAccess, authorization: string) {
  const token = authorization.replace(/^Bearer\s+/i, "");
  const supabase = createAdminClient();
  const revokedAt = new Date().toISOString();
  const { data, error } = await supabase.from("work_desktop_sessions")
    .update({ revoked_at: revokedAt })
    .eq("organization_id", access.organizationId)
    .eq("user_id", access.ctx.user.id)
    .eq("token_hash", sha256(token))
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`revoke desktop session: ${error.message}`);
  if (data) await supabase.from("work_audit_log").insert({
    organization_id: access.organizationId,
    actor_user_id: access.ctx.user.id,
    action: "desktop.session_revoked",
    target_type: "desktop_session",
    target_id: data.id,
  });
  return { revoked: !!data };
}
