import assert from "node:assert/strict";
import test from "node:test";
import { actorSam, fixture, person, scope } from "./helpers/work-os-ghl-fixture.mts";
import { decryptProviderSecret } from "../src/lib/work-os-secrets";
import { analyzeGhlEmail, emailBodyToText, getGhlEmailForViewer } from "../src/lib/work-os-ghl-email";
import { ghlMappingRevision, loadGhlIdentities, persistGhlRecords } from "../src/lib/work-os-ghl-store";
import { normalizeGhlRecord } from "../src/lib/work-os-ghl-normalize";
import type { WorkOsAccess } from "../src/lib/work-os-api";

process.env.WORK_OS_PROVIDER_SECRET_KEY = Buffer.alloc(32, 5).toString("base64");

const userId = "aaaaaaaa-0000-4000-8000-000000000001";

function access(overrides: Partial<WorkOsAccess> = {}): WorkOsAccess {
  return {
    ctx: { user: { id: userId }, profile: { id: userId } as any },
    organizationId: scope.organizationId,
    organizationName: "Wrazy",
    organizationOwnerId: null,
    role: "employee",
    personId: person,
    membershipId: "membership",
    featureFlags: { ghl_evidence: true },
    workspaces: [],
    ...overrides,
  } as WorkOsAccess;
}

async function rows(db: { query: (sql: string) => Promise<{ rows: unknown[] }> }, sql: string) {
  return (await db.query(sql)).rows as Array<Record<string, any>>;
}

async function seedEmail(f: Awaited<ReturnType<typeof fixture>>, occurredAt = "2026-11-03T18:17:00.000Z") {
  const identities = await loadGhlIdentities(scope);
  const record = normalizeGhlRecord("email", {
    id: "msg-email-1",
    conversationId: "conv-1",
    type: "TYPE_EMAIL",
    direction: "outbound",
    source: "app",
    userId: actorSam,
    dateAdded: occurredAt,
    status: "delivered",
    emailDetail: { subject: "Proposal for review" },
  }, { scope, identities, observedAt: "2026-11-06T12:00:00.000Z" })[0];
  await persistGhlRecords(scope, [record], ghlMappingRevision(identities));
  const event = (await rows(f.db, "select id from work_evidence_events where provider = 'ghl'")).at(0)!;
  return event.id as string;
}

test("HTML email text excludes scripts, styles, remote images, and tags", () => {
  const result = emailBodyToText(
    '<script>secret()</script><style>body{}</style><p>Sent a <strong>proposal</strong>.</p><img src="https://tracker.invalid/p"><a href="https://x.invalid">Open</a>',
    "text/html",
  );
  assert.equal(result.text, "Sent a proposal. Open");
  assert.equal(result.truncated, false);
});

test("plain text keeps content but removes the quoted thread", () => {
  const result = emailBodyToText(
    "Thanks for the call.\n\nOn Tue, Nov 3, 2026 at 4:00 PM Customer <customer@example.invalid> wrote:\n> old thread\n> more thread",
    "text/plain",
  );
  assert.equal(result.text, "Thanks for the call.");
});

test("analysis input is capped with an explicit truncation flag", () => {
  const result = emailBodyToText("a".repeat(20_000), "text/plain");
  assert.equal(result.text.length, 12_000);
  assert.equal(result.truncated, true);
  const large = emailBodyToText("<p>" + "b".repeat(200_000) + "</p>", "text/html");
  assert.equal(large.text.length <= 12_000, true);
  assert.equal(large.truncated, true);
});

test("analysis retains grounded excerpts, never the full body, and reuses an unchanged hash", async () => {
  const f = await fixture();
  try {
    const eventId = await seedEmail(f);
    let calls = 0;
    const complete = async () => {
      calls += 1;
      return {
        summary: "Sent the customer a proposal for review.",
        claims: [{ description: "Proposal sent", quote: "Sent a proposal for your review." }],
      };
    };
    const first = await analyzeGhlEmail({
      scope, eventId, emailId: "msg-email-1", now: new Date("2026-11-06T12:00:00.000Z"),
      fetchEmail: async () => ({
        id: "msg-email-1",
        subject: "Proposal",
        contentType: "text/plain",
        body: "Sent a proposal for your review. SYNTHETIC_EMAIL_BODY_SENTINEL",
      }),
      complete,
    });
    assert.equal(first.state, "ready");
    assert.equal(calls, 1);
    const stored = (await rows(f.db, "select excerpt_cipher, summary_cipher from work_ghl_email_content")).at(0)!;
    assert.equal(decryptProviderSecret(String(stored.excerpt_cipher)), "Sent a proposal for your review.");
    assert.equal(decryptProviderSecret(String(stored.summary_cipher)), "Sent the customer a proposal for review.");
    const allRows = JSON.stringify(await rows(f.db, "select * from work_ghl_email_content"));
    assert.equal(allRows.includes("SYNTHETIC_EMAIL_BODY_SENTINEL"), false, "the full body is never persisted");
    const second = await analyzeGhlEmail({
      scope, eventId, emailId: "msg-email-1", now: new Date("2026-11-06T12:00:00.000Z"),
      fetchEmail: async () => ({
        id: "msg-email-1",
        subject: "Proposal",
        contentType: "text/plain",
        body: "Sent a proposal for your review. SYNTHETIC_EMAIL_BODY_SENTINEL",
      }),
      complete,
    });
    assert.equal(second.state, "ready");
    assert.equal(calls, 1, "an unchanged content hash reuses the analysis");
  } finally {
    await f.close();
  }
});

test("absent or invented quotes are discarded and cannot ground a summary", async () => {
  const f = await fixture();
  try {
    const eventId = await seedEmail(f);
    const result = await analyzeGhlEmail({
      scope, eventId, emailId: "msg-email-1", now: new Date("2026-11-06T12:00:00.000Z"),
      fetchEmail: async () => ({ id: "msg-email-1", subject: "Proposal", contentType: "text/plain", body: "Sent a proposal." }),
      complete: async () => ({ summary: "Marked the task complete.", claims: [{ description: "Task complete", quote: "I finished everything" }] }),
    });
    assert.equal(result.state, "unavailable");
    const stored = (await rows(f.db, "select summary_cipher, excerpt_cipher from work_ghl_email_content")).at(0)!;
    assert.equal(stored.summary_cipher, null);
    assert.equal(stored.excerpt_cipher, null);
  } finally {
    await f.close();
  }
});

test("an AI failure degrades to metadata-only instead of guessed prose", async () => {
  const f = await fixture();
  try {
    const eventId = await seedEmail(f);
    const result = await analyzeGhlEmail({
      scope, eventId, emailId: "msg-email-1", now: new Date("2026-11-06T12:00:00.000Z"),
      fetchEmail: async () => ({ id: "msg-email-1", subject: "Proposal", contentType: "text/plain", body: "Sent a proposal." }),
      complete: async () => { throw new Error("provider down"); },
    });
    assert.equal(result.state, "unavailable");
    const stored = (await rows(f.db, "select summary_cipher from work_ghl_email_content")).at(0)!;
    assert.equal(stored.summary_cipher, null);
  } finally {
    await f.close();
  }
});

test("content older than retention is expired and is never fetched or analyzed", async () => {
  const f = await fixture();
  try {
    const eventId = await seedEmail(f, "2026-01-01T12:00:00.000Z");
    let fetched = false;
    let analyzed = false;
    const result = await analyzeGhlEmail({
      scope, eventId, emailId: "msg-email-1", now: new Date("2026-11-06T12:00:00.000Z"),
      fetchEmail: async () => { fetched = true; return { id: "msg-email-1", body: "old", contentType: "text/plain" }; },
      complete: async () => { analyzed = true; return { summary: "", claims: [] }; },
    });
    assert.equal(result.state, "expired");
    assert.equal(fetched, false);
    assert.equal(analyzed, false);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_ghl_email_content")).at(0)!.n, 0);
  } finally {
    await f.close();
  }
});

test("viewing enforces the retention window even when no content row exists", async () => {
  const f = await fixture();
  try {
    const eventId = await seedEmail(f, "2026-01-01T12:00:00.000Z");
    let fetched = false;
    const result = await getGhlEmailForViewer(access(), eventId, {
      now: new Date("2026-11-06T12:00:00.000Z"),
      fetchEmail: async () => { fetched = true; return { id: "msg-email-1", body: "old", contentType: "text/plain" }; },
    });
    assert.equal(result.availability, "expired");
    assert.equal(fetched, false);
  } finally {
    await f.close();
  }
});

test("authorized viewing fetches the full email on demand without storing it", async () => {
  const f = await fixture();
  try {
    const eventId = await seedEmail(f);
    const result = await getGhlEmailForViewer(access(), eventId, {
      fetchEmail: async () => ({
        id: "msg-email-1",
        subject: "Proposal",
        contentType: "text/html",
        body: "<p>SYNTHETIC_EMAIL_BODY_SENTINEL full body</p><script>bad()</script>",
      }),
    });
    assert.equal(result.availability, "available");
    assert.equal(result.text, "SYNTHETIC_EMAIL_BODY_SENTINEL full body");
    assert.equal((await rows(f.db, "select count(*)::int as n from work_ghl_email_content")).at(0)!.n, 0);
    assert.equal((await rows(f.db, "select count(*)::int as n from work_audit_log where action = 'evidence.ghl_email.viewed'")).at(0)!.n, 1);
  } finally {
    await f.close();
  }
});

test("provider failure keeps the permitted excerpt and states the full source is unavailable", async () => {
  const f = await fixture();
  try {
    const eventId = await seedEmail(f);
    await analyzeGhlEmail({
      scope, eventId, emailId: "msg-email-1", now: new Date("2026-11-06T12:00:00.000Z"),
      fetchEmail: async () => ({ id: "msg-email-1", subject: "Proposal", contentType: "text/plain", body: "Sent a proposal." }),
      complete: async () => ({ summary: "Sent a proposal.", claims: [{ description: "Proposal", quote: "Sent a proposal." }] }),
    });
    const result = await getGhlEmailForViewer(access(), eventId, {
      fetchEmail: async () => { throw new Error("provider unavailable"); },
    });
    assert.equal(result.availability, "unavailable");
    assert.equal(result.text, null);
    assert.equal(result.excerpt, "Sent a proposal.");
  } finally {
    await f.close();
  }
});
