import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildMemberPasswordResetUrl,
  MEMBER_PASSWORD_RESET_COOLDOWN_MS,
  sendMemberPasswordReset,
  type MemberPasswordResetDeps,
} from "../src/lib/work-os-member-password-reset.ts";

function makeDeps(overrides: Partial<MemberPasswordResetDeps> = {}) {
  const createdVerifications: Array<{ identifier: string; value: string; expiresAt: Date }> = [];
  const deletedVerifications: string[] = [];
  const sentEmails: Array<{
    appOrigin: string;
    displayName: string;
    email: string;
    resetUrl: string;
    initiatedByAdmin: boolean;
  }> = [];
  const audits: Array<{
    organizationId: string;
    actorUserId: string;
    membershipId: string;
    metadata: Record<string, unknown>;
  }> = [];

  const deps: MemberPasswordResetDeps = {
    appOrigin: "https://app.wrazyos.com",
    authBaseUrl: "https://app.wrazyos.com/api/auth",
    tokenExpiresInSeconds: 3600,
    now: () => Date.parse("2026-11-24T17:00:00.000Z"),
    generateToken: () => "tok_test_1234567890",
    loadMembership: async () => ({
      id: "mem-1",
      user_id: "user-1",
      active: true,
      person: { display_name: "Aden Badon", email: "aden@maigreeks.com" },
    }),
    findAuthUserById: async () => ({
      id: "user-1",
      email: "aden@maigreeks.com",
      name: "Aden B. Aden",
    }),
    loadLastResetAt: async () => null,
    createVerification: async (entry) => {
      createdVerifications.push(entry);
    },
    deleteVerification: async (identifier) => {
      deletedVerifications.push(identifier);
    },
    sendEmail: async (input) => {
      sentEmails.push(input);
      return { id: "re_12345" };
    },
    writeAudit: async (entry) => {
      audits.push(entry);
    },
    ...overrides,
  };

  return { deps, createdVerifications, deletedVerifications, sentEmails, audits };
}

test("buildMemberPasswordResetUrl emits Better Auth callback URL without duplicating /api/auth", () => {
  assert.equal(
    buildMemberPasswordResetUrl("https://app.wrazyos.com/api/auth", "https://app.wrazyos.com", "abc123"),
    "https://app.wrazyos.com/api/auth/reset-password/abc123?callbackURL=https%3A%2F%2Fapp.wrazyos.com%2Freset-password",
  );
  assert.equal(
    buildMemberPasswordResetUrl("https://app.wrazyos.com/", "https://app.wrazyos.com/", "abc123"),
    "https://app.wrazyos.com/api/auth/reset-password/abc123?callbackURL=https%3A%2F%2Fapp.wrazyos.com%2Freset-password",
  );
});

test("sendMemberPasswordReset issues a Better Auth token, awaits delivery, and audits the send", async () => {
  const { deps, createdVerifications, deletedVerifications, sentEmails, audits } = makeDeps();
  const result = await sendMemberPasswordReset(
    { organizationId: "org-1", actorUserId: "admin-1", membershipId: "mem-1" },
    deps,
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  if (!result.ok) return;

  assert.equal(result.body.sent, true);
  assert.equal(result.body.membershipId, "mem-1");
  assert.equal(result.body.email, "aden@maigreeks.com");
  assert.equal(result.body.emailId, "re_12345");
  assert.equal(result.body.sentAt, "2026-11-24T17:00:00.000Z");
  assert.equal(result.body.expiresAt, "2026-11-24T18:00:00.000Z");

  assert.equal(createdVerifications.length, 1);
  assert.equal(createdVerifications[0].identifier, "reset-password:tok_test_1234567890");
  assert.equal(createdVerifications[0].value, "user-1");
  assert.equal(createdVerifications[0].expiresAt.toISOString(), "2026-11-24T18:00:00.000Z");

  assert.equal(deletedVerifications.length, 0);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].initiatedByAdmin, true);
  assert.equal(sentEmails[0].email, "aden@maigreeks.com");
  assert.equal(sentEmails[0].displayName, "Aden B. Aden");
  assert.match(sentEmails[0].resetUrl, /\/api\/auth\/reset-password\/tok_test_1234567890\?callbackURL=/);

  assert.equal(audits.length, 1);
  assert.equal(audits[0].organizationId, "org-1");
  assert.equal(audits[0].actorUserId, "admin-1");
  assert.equal(audits[0].membershipId, "mem-1");
  assert.equal(audits[0].metadata.emailId, "re_12345");
});

test("sendMemberPasswordReset rejects missing membership, inactive member, and missing auth email", async () => {
  const missing = makeDeps({ loadMembership: async () => null });
  const missingResult = await sendMemberPasswordReset(
    { organizationId: "org-1", actorUserId: "admin-1", membershipId: "mem-404" },
    missing.deps,
  );
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.status, 404);
  assert.equal(missing.sentEmails.length, 0);

  const inactive = makeDeps({
    loadMembership: async () => ({ id: "mem-2", user_id: "user-2", active: false }),
  });
  const inactiveResult = await sendMemberPasswordReset(
    { organizationId: "org-1", actorUserId: "admin-1", membershipId: "mem-2" },
    inactive.deps,
  );
  assert.equal(inactiveResult.ok, false);
  assert.equal(inactiveResult.status, 409);
  assert.equal(inactive.sentEmails.length, 0);

  const noAuth = makeDeps({ findAuthUserById: async () => null });
  const noAuthResult = await sendMemberPasswordReset(
    { organizationId: "org-1", actorUserId: "admin-1", membershipId: "mem-1" },
    noAuth.deps,
  );
  assert.equal(noAuthResult.ok, false);
  assert.equal(noAuthResult.status, 409);
  assert.equal(noAuth.sentEmails.length, 0);
});

test("sendMemberPasswordReset enforces the per-member cooldown and allows retries once elapsed", async () => {
  const nowMs = Date.parse("2026-11-24T17:00:00.000Z");
  const cooling = makeDeps({
    now: () => nowMs,
    loadLastResetAt: async () => new Date(nowMs - 15_000).toISOString(),
  });
  const blocked = await sendMemberPasswordReset(
    { organizationId: "org-1", actorUserId: "admin-1", membershipId: "mem-1" },
    cooling.deps,
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);
  if (!blocked.ok) assert.equal(blocked.body.retryAfterSeconds, 45);
  assert.equal(cooling.sentEmails.length, 0);

  const elapsed = makeDeps({
    now: () => nowMs,
    loadLastResetAt: async () => new Date(nowMs - MEMBER_PASSWORD_RESET_COOLDOWN_MS - 1_000).toISOString(),
  });
  const allowed = await sendMemberPasswordReset(
    { organizationId: "org-1", actorUserId: "admin-1", membershipId: "mem-1" },
    elapsed.deps,
  );
  assert.equal(allowed.ok, true);
  assert.equal(allowed.status, 200);
});

test("sendMemberPasswordReset deletes the verification token and returns 502 if Resend fails", async () => {
  const { deps, createdVerifications, deletedVerifications, audits } = makeDeps({
    sendEmail: async () => {
      throw new Error("Resend upstream 502");
    },
  });
  const result = await sendMemberPasswordReset(
    { organizationId: "org-1", actorUserId: "admin-1", membershipId: "mem-1" },
    deps,
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  if (!result.ok) assert.match(result.body.error, /Resend upstream 502/);
  assert.equal(createdVerifications.length, 1);
  assert.deepEqual(deletedVerifications, ["reset-password:tok_test_1234567890"]);
  assert.equal(audits.length, 0);
});

test("password reset route requires admin authorization, desktop bearer headers, and server-side email resolution", async () => {
  const route = await readFile(
    new URL("../src/app/api/work-os/organization/members/[membershipId]/password-reset/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /roles: \["admin"\]/);
  assert.match(route, /authorization: req\.headers\.get\("authorization"\)/);
  assert.match(route, /organizationId: req\.headers\.get\("x-work-os-organization-id"\)/);
  assert.doesNotMatch(route, /req\.json\(\)/, "Route must not accept client-supplied email addresses");
});
