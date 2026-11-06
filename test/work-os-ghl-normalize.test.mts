import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeGhlRecord, normalizeGhlAppointmentCoverage } from "../src/lib/work-os-ghl-normalize";
import type { GhlIdentity, GhlKind, GhlScope } from "../src/lib/work-os-ghl-types";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/work-os-ghl.json", import.meta.url), "utf8"));
const scope: GhlScope = {
  organizationId: "org-1",
  connectionId: "conn-1",
  locationId: fixtures.locationId,
};
const context = {
  scope,
  identities: fixtures.identities as GhlIdentity[],
  observedAt: "2026-11-06T12:00:00.000Z",
};

function one(kind: GhlKind, payload: unknown) {
  const records = normalizeGhlRecord(kind, payload, context);
  assert.equal(records.length, 1);
  return records[0];
}

test("workflow source cannot become personal work", () => {
  assert.equal(one("email", fixtures.workflowEmail).relation, "automation");
});

test("workflow detail source outranks an app-labeled envelope", () => {
  assert.equal(one("email", fixtures.manualEmailWithWorkflowDetail).relation, "automation");
});

test("manual outgoing email from a verified actor is performed", () => {
  const record = one("email", fixtures.manualEmail);
  assert.equal(record.relation, "performed");
  assert.equal(record.actorId, "VN13egA2TXXCZk90XewJ");
  assert.equal(record.kind, "email");
  assert.equal(record.emailId, "msg-manual-1");
  assert.equal(record.conversationId, "conv-2");
  assert.equal(record.occurredAt, "2026-11-03T18:17:00.000Z");
});

test("inbound email and SMS are context, not the employee's action", () => {
  assert.equal(one("email", { ...fixtures.manualEmail, direction: "inbound" }).relation, "unknown");
  assert.equal(one("sms", { ...fixtures.sms, direction: "inbound" }).relation, "unknown");
});

test("API-originated messages are not automatically the employee's action", () => {
  assert.equal(one("email", { ...fixtures.manualEmail, source: "api", emailDetail: {} }).relation, "unknown");
});

test("email without a documented sender user is unknown, never performed", () => {
  const record = one("email", fixtures.emailWithoutSenderUserId);
  assert.equal(record.relation, "unknown");
  assert.equal(record.actorId, null);
});

test("an unverified identity is not credited as performed", () => {
  const record = one("note", fixtures.unverifiedUserNote);
  assert.equal(record.relation, "unknown");
  assert.equal(record.actorId, "iRVuCaXZPdlSXiROT6W1");
});

test("shared-account activity is shared, not personal", () => {
  const record = one("note", fixtures.sharedAccountNote);
  assert.equal(record.relation, "shared_account");
});

test("a missed incoming call remains contextual, not performed work", () => {
  const record = one("call", fixtures.incomingCall);
  assert.equal(record.relation, "unknown");
  assert.equal(record.status, "no-answer");
  assert.equal(record.durationSeconds, 5);
});

test("an answered incoming call does not prove who answered", () => {
  assert.equal(one("call", fixtures.answeredIncomingCall).relation, "unknown");
});

test("an outbound call from a verified actor is performed", () => {
  const record = one("call", fixtures.outboundCall);
  assert.equal(record.relation, "performed");
  assert.equal(record.durationSeconds, 120);
});

test("appointment assignment alone is not the actor; future meeting uses creation time", () => {
  const record = one("appointment", fixtures.assignedOnlyAppointment);
  assert.equal(record.relation, "assigned_only");
  assert.equal(record.actorId, null);
  assert.equal(record.occurredAt, "2026-11-03T22:00:00.000Z");
  assert.notEqual(record.occurredAt?.slice(0, 4), "2027");
});

test("documented appointment createdBy user becomes the actor", () => {
  const record = one("appointment", fixtures.appointmentCreatedByUser);
  assert.equal(record.actorId, "VN13egA2TXXCZk90XewJ");
  assert.equal(record.relation, "performed");
});

test("missing provider timestamp stays null instead of using observation time", () => {
  const record = one("appointment", fixtures.appointmentWithoutTimestamps);
  assert.equal(record.occurredAt, null);
  assert.equal(record.observedAt, context.observedAt);
});

test("invalid dates and negative durations are normalized without invention", () => {
  const record = normalizeGhlRecord("call", {
    id: "call-invalid",
    type: "TYPE_CALL",
    direction: "outbound",
    source: "app",
    userId: "VN13egA2TXXCZk90XewJ",
    dateAdded: "not-a-date",
    call: { duration: -30 },
  }, context)[0];
  assert.equal(record.occurredAt, null);
  assert.equal(record.durationSeconds, null);
});

test("same object with different actions produces distinct logical keys and preserves snapshots", () => {
  const first = one("opportunity", fixtures.opportunity);
  const second = one("opportunity", { ...fixtures.opportunity, status: "won" });
  assert.notEqual(first.key, second.key);
  assert.equal(first.snapshot, true);
  assert.equal(first.relation, "assigned_only");
});

test("an unchanged repeated provider snapshot reuses its logical key", () => {
  const first = one("appointment", fixtures.assignedOnlyAppointment);
  const second = one("appointment", fixtures.assignedOnlyAppointment);
  assert.equal(first.key, second.key);
});

test("SMS keeps its channel and actor relationship separate", () => {
  const record = one("sms", fixtures.sms);
  assert.equal(record.kind, "sms");
  assert.equal(record.relation, "performed");
  assert.equal(record.status, "delivered");
});

test("unmapped identities stay unknown and are not invented", () => {
  const record = normalizeGhlRecord("note", {
    id: "note-unknown",
    contactId: "contact-1",
    userId: "user-not-in-directory",
    body: "Noted.",
    dateAdded: "2026-11-03T20:00:00.000Z",
  }, context)[0];
  assert.equal(record.relation, "unknown");
  assert.equal(record.actorId, "user-not-in-directory");
});

test("calendar discovery cannot claim complete booking history", () => {
  const coverage = normalizeGhlAppointmentCoverage({
    scope,
    scheduledFrom: "2026-11-01T04:00:00.000Z",
    scheduledThrough: "2027-11-01T04:00:00.000Z",
    scanned: 12,
    capped: false,
  });
  assert.equal(coverage.state, "partial");
  assert.match(String(coverage.reason), /scheduled/i);
});
