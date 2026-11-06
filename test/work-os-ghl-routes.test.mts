import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canViewGhlOrganizationContext, ghlEvidenceRow, isApprovedGhlSourceUrl } from "../src/lib/work-os-ghl-evidence-view";

test("shared GHL organization context is admin-only", () => {
  assert.equal(canViewGhlOrganizationContext({ role: "admin" }), true);
  assert.equal(canViewGhlOrganizationContext({ role: "manager" }), false);
  assert.equal(canViewGhlOrganizationContext({ role: "employee" }), false);
});

test("a shared GHL event projects relation and availability without raw bodies or credentials", () => {
  const row = ghlEvidenceRow({
    id: "event-1",
    person_id: null,
    occurred_at: "2026-11-03T20:00:00.000Z",
    title: "Contact note added",
    summary: "Contact note recorded by GHL.",
    evidence_class: "output_evidence",
    correction_status: "original",
    metadata: {
      actor: { id: "actor-1", login: null },
      ghl: {
        kind: "note",
        action: "created",
        relation: "shared_account",
        emailId: null,
        snapshot: false,
        body: "SYNTHETIC_EMAIL_BODY_SENTINEL",
      },
    },
  });
  assert.equal(row.source, "ghl");
  assert.equal((row.ghl as any).relation, "shared_account");
  assert.equal((row.ghl as any).actorLabel, "Shared account — not one employee");
  assert.equal((row.ghl as any).contentAvailability, "metadata_only");
  assert.equal(JSON.stringify(row).includes("SYNTHETIC_EMAIL_BODY_SENTINEL"), false);
  assert.equal(JSON.stringify(row).toLowerCase().includes("token"), false);
});

test("only a validated HTTPS GHL source host can become an exact-record link", () => {
  assert.equal(isApprovedGhlSourceUrl("https://app.gohighlevel.com/v2/location/abc/conversations"), true);
  assert.equal(isApprovedGhlSourceUrl("https://evil.example/gohighlevel.com"), false);
  assert.equal(isApprovedGhlSourceUrl("http://app.gohighlevel.com/v2/location/abc"), false);
  assert.equal(isApprovedGhlSourceUrl("javascript:alert(1)"), false);
  assert.equal(isApprovedGhlSourceUrl(null), false);
});

test("the email viewer fetches on demand without HTML injection", () => {
  const source = readFileSync(new URL("../src/modules/work-os/admin/GhlEvidenceDetail.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("dangerouslySetInnerHTML"), false);
  assert.equal(source.includes("cache: \"no-store\""), true);
  assert.equal(source.includes("/ghl-email"), true);
  assert.equal(source.includes("Full email unavailable"), true);
  assert.equal(source.includes("Exact GHL link not verified"), true);
});
