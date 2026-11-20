import assert from "node:assert/strict";
import test from "node:test";
import { ghlEvidenceRow } from "../src/lib/work-os-ghl-evidence-view";

function event(relation: string, actorId: string | null = "U0iE") {
  return {
    id: "event-1",
    person_id: null,
    occurred_at: "2026-11-11T20:59:12.364Z",
    title: "Call inbound",
    summary: "Call inbound with status completed.",
    evidence_class: "output_evidence",
    correction_status: "original",
    metadata: { ghl: { relation, actorId, kind: "call", action: "received" }, actor: { id: actorId } },
  };
}

const aden = { id: "person-aden", displayName: "Aden Badon" };

test("a mapped actor is named instead of reading as an unmapped person", () => {
  // A verified mapping is the workspace's answer to "whose account is this".
  // The label states the person plainly and never hedges.
  const label = (ghlEvidenceRow(event("unknown"), aden).ghl as { actorLabel: string }).actorLabel;
  assert.equal(label, "Aden Badon");
  assert.doesNotMatch(label, /not established|unknown|unmapped/i);
});

test("a performed relation is also stated as the person, with no hedging", () => {
  const label = (ghlEvidenceRow(event("performed"), aden).ghl as { actorLabel: string }).actorLabel;
  assert.equal(label, "Aden Badon");
});

test("automation and shared accounts stay labelled while naming the person", () => {
  assert.equal(
    (ghlEvidenceRow(event("automation"), aden).ghl as { actorLabel: string }).actorLabel,
    "Automation — Aden Badon",
  );
  assert.equal(
    (ghlEvidenceRow(event("shared_account"), aden).ghl as { actorLabel: string }).actorLabel,
    "Shared account — Aden Badon",
  );
});

test("an unmapped actor keeps the plain provider-relation label", () => {
  assert.equal(
    (ghlEvidenceRow(event("unknown", "nobody")).ghl as { actorLabel: string }).actorLabel,
    "Actor unknown",
  );
  assert.equal(
    (ghlEvidenceRow(event("automation", null)).ghl as { actorLabel: string }).actorLabel,
    "Automation — not the employee",
  );
  // No mapped person supplied at all behaves the same way.
  assert.equal(
    (ghlEvidenceRow(event("unknown")).ghl as { actorLabel: string }).actorLabel,
    "Actor unknown",
  );
});

test("an assigned-only record names its owner without claiming the action", () => {
  const row = event("assigned_only", null);
  (row.metadata.ghl as Record<string, unknown>).assigneeIds = ["mwha6"];
  const projected = ghlEvidenceRow(row, null, new Map([["mwha6", { id: "person-kalia", displayName: "Kalia Bell" }]]));
  const ghl = projected.ghl as { actorLabel: string; assigneeLabels: string[]; relation: string };
  assert.deepEqual(ghl.assigneeLabels, ["Kalia Bell"]);
  assert.equal(ghl.relation, "assigned_only");
  assert.equal(ghl.actorLabel, "Assigned contact only — actor unknown");
  assert.equal(projected.person_id, null, "ownership is context, not a person attribution");
});

test("the mapped-actor name does not become a person attribution", () => {
  const row = ghlEvidenceRow(event("unknown"), aden);
  // Organization context: still not one person's evidence row.
  assert.equal(row.person_id, null);
  assert.equal(row.person, null);
  assert.equal((row.metrics as { relation: string }).relation, "unknown");
});
