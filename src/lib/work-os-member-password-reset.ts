import { randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/passwordResetEmail";
import { createAdminClient } from "@/lib/supabase/admin";

export const MEMBER_PASSWORD_RESET_COOLDOWN_MS = 60_000;
export const MEMBER_PASSWORD_RESET_TTL_SECONDS = 60 * 60;
export const MEMBER_PASSWORD_RESET_AUDIT_ACTION = "organization.member_password_reset_sent";

export interface MemberPasswordResetMembership {
  id: string;
  user_id: string;
  active: boolean;
  person?: { display_name?: string | null; email?: string | null } | null;
}

export interface MemberPasswordResetAuthUser {
  id: string;
  email: string;
  name?: string | null;
}

export interface MemberPasswordResetDeps {
  appOrigin: string;
  authBaseUrl: string;
  tokenExpiresInSeconds: number;
  now: () => number;
  generateToken: () => string;
  loadMembership: (organizationId: string, membershipId: string) => Promise<MemberPasswordResetMembership | null>;
  findAuthUserById: (userId: string) => Promise<MemberPasswordResetAuthUser | null>;
  loadLastResetAt: (organizationId: string, membershipId: string) => Promise<string | null>;
  createVerification: (input: { identifier: string; value: string; expiresAt: Date }) => Promise<void>;
  deleteVerification: (identifier: string) => Promise<void>;
  sendEmail: (input: {
    appOrigin: string;
    displayName: string;
    email: string;
    resetUrl: string;
    initiatedByAdmin: boolean;
  }) => Promise<{ id: string | null }>;
  writeAudit: (input: {
    organizationId: string;
    actorUserId: string;
    membershipId: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
}

export type MemberPasswordResetResult =
  | {
      ok: true;
      status: 200;
      body: {
        sent: true;
        membershipId: string;
        email: string;
        sentAt: string;
        expiresAt: string;
        emailId: string | null;
      };
    }
  | {
      ok: false;
      status: 400 | 404 | 409 | 429 | 502;
      body: {
        error: string;
        retryAfterSeconds?: number;
      };
    };

/** Build the Better Auth reset callback URL, matching better-auth's
 * `/api/auth/reset-password/:token?callbackURL=...` route contract. */
export function buildMemberPasswordResetUrl(authBaseUrl: string, appOrigin: string, token: string): string {
  const cleanOrigin = appOrigin.replace(/\/+$/, "");
  const cleanAuthBase = authBaseUrl.replace(/\/+$/, "");
  const authBase = cleanAuthBase.endsWith("/api/auth") ? cleanAuthBase : `${cleanAuthBase}/api/auth`;
  const redirectTo = `${cleanOrigin}/reset-password`;
  return `${authBase}/reset-password/${encodeURIComponent(token)}?callbackURL=${encodeURIComponent(redirectTo)}`;
}

export async function createDefaultMemberPasswordResetDeps(): Promise<MemberPasswordResetDeps> {
  const db = createAdminClient();
  const authCtx = await auth.$context;
  const appOrigin = (process.env.APP_PUBLIC_ORIGIN?.trim() || "https://app.wrazyos.com").replace(/\/+$/, "");
  const authBaseUrl = (authCtx.baseURL || `${appOrigin}/api/auth`).replace(/\/+$/, "");
  const tokenExpiresInSeconds =
    authCtx.options.emailAndPassword?.resetPasswordTokenExpiresIn || MEMBER_PASSWORD_RESET_TTL_SECONDS;

  return {
    appOrigin,
    authBaseUrl,
    tokenExpiresInSeconds,
    now: () => Date.now(),
    generateToken: () => randomBytes(24).toString("base64url"),
    async loadMembership(organizationId, membershipId) {
      const { data, error } = await db
        .from("work_org_members")
        .select("id,user_id,active,person:work_people(display_name,email)")
        .eq("organization_id", organizationId)
        .eq("id", membershipId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const person = Array.isArray(data.person) ? data.person[0] ?? null : data.person ?? null;
      return {
        id: String(data.id),
        user_id: String(data.user_id),
        active: data.active !== false,
        person,
      };
    },
    async findAuthUserById(userId) {
      const user = await authCtx.internalAdapter.findUserById(userId);
      if (!user || typeof user.email !== "string" || !user.email.trim()) return null;
      return {
        id: String(user.id),
        email: user.email.trim(),
        name: typeof user.name === "string" ? user.name : null,
      };
    },
    async loadLastResetAt(organizationId, membershipId) {
      const { data, error } = await db
        .from("work_audit_log")
        .select("created_at")
        .eq("organization_id", organizationId)
        .eq("action", MEMBER_PASSWORD_RESET_AUDIT_ACTION)
        .eq("target_type", "membership")
        .eq("target_id", membershipId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return typeof data?.created_at === "string" ? data.created_at : null;
    },
    async createVerification({ identifier, value, expiresAt }) {
      await authCtx.internalAdapter.createVerificationValue({
        identifier,
        value,
        expiresAt,
      });
    },
    async deleteVerification(identifier) {
      await authCtx.internalAdapter.deleteVerificationByIdentifier(identifier);
    },
    async sendEmail(params) {
      return sendPasswordResetEmail(params);
    },
    async writeAudit({ organizationId, actorUserId, membershipId, metadata }) {
      const { error } = await db.from("work_audit_log").insert({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        action: MEMBER_PASSWORD_RESET_AUDIT_ACTION,
        target_type: "membership",
        target_id: membershipId,
        metadata,
      });
      if (error) throw new Error(`write Work OS audit log: ${error.message}`);
    },
  };
}

/** Issue a Better Auth 1-hour password reset token for a verified workspace
 * member and await mail delivery so the admin receives a truthful receipt. */
export async function sendMemberPasswordReset(
  input: {
    organizationId: string;
    actorUserId: string;
    membershipId: string;
  },
  deps: MemberPasswordResetDeps,
): Promise<MemberPasswordResetResult> {
  const membershipId = input.membershipId.trim();
  if (!membershipId) {
    return { ok: false, status: 400, body: { error: "membershipId is required." } };
  }

  const membership = await deps.loadMembership(input.organizationId, membershipId);
  if (!membership) {
    return { ok: false, status: 404, body: { error: "Member not found in this workspace." } };
  }

  if (!membership.active) {
    return {
      ok: false,
      status: 409,
      body: { error: "Activate this member before sending a password reset email." },
    };
  }

  const authUser = await deps.findAuthUserById(membership.user_id);
  if (!authUser || !authUser.email.trim()) {
    return {
      ok: false,
      status: 409,
      body: { error: "This member does not have a WrazyOS sign-in email." },
    };
  }

  const nowMs = deps.now();
  const lastResetAt = await deps.loadLastResetAt(input.organizationId, membership.id);
  if (lastResetAt) {
    const lastMs = Date.parse(lastResetAt);
    if (Number.isFinite(lastMs)) {
      const remainingMs = MEMBER_PASSWORD_RESET_COOLDOWN_MS - (nowMs - lastMs);
      if (remainingMs > 0) {
        const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
        return {
          ok: false,
          status: 429,
          body: {
            error: `A password reset email was just sent to ${authUser.email}. Wait ${retryAfterSeconds}s before sending another.`,
            retryAfterSeconds,
          },
        };
      }
    }
  }

  const token = deps.generateToken();
  const identifier = `reset-password:${token}`;
  const expiresAt = new Date(nowMs + deps.tokenExpiresInSeconds * 1000);
  const resetUrl = buildMemberPasswordResetUrl(deps.authBaseUrl, deps.appOrigin, token);

  await deps.createVerification({
    identifier,
    value: authUser.id,
    expiresAt,
  });

  let delivered: { id: string | null };
  try {
    delivered = await deps.sendEmail({
      appOrigin: deps.appOrigin,
      displayName: authUser.name?.trim() || membership.person?.display_name?.trim() || authUser.email,
      email: authUser.email,
      resetUrl,
      initiatedByAdmin: true,
    });
  } catch (error) {
    // Best-effort cleanup so a failed mail attempt does not leave an active token behind.
    try {
      await deps.deleteVerification(identifier);
    } catch {
      // Preserve the primary delivery error.
    }
    const detail = error instanceof Error && error.message.trim() ? error.message.trim() : "Mail provider error.";
    return {
      ok: false,
      status: 502,
      body: { error: `Could not send password reset email: ${detail}` },
    };
  }

  const sentAt = new Date(nowMs).toISOString();
  await deps.writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    membershipId: membership.id,
    metadata: {
      userId: authUser.id,
      email: authUser.email,
      emailId: delivered.id,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return {
    ok: true,
    status: 200,
    body: {
      sent: true,
      membershipId: membership.id,
      email: authUser.email,
      sentAt,
      expiresAt: expiresAt.toISOString(),
      emailId: delivered.id,
    },
  };
}
