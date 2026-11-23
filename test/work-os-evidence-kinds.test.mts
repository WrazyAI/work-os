import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceKind,
  evidenceKindBucket,
  evidenceKindLabel,
} from "../src/modules/work-os/evidence-kinds";

test("classifies provider and observed evidence by source and title", () => {
  assert.equal(evidenceKind("ghl", "Call outbound"), "call");
  assert.equal(evidenceKind("ghl", "Call inbound"), "call");
  assert.equal(evidenceKind("ghl", "Email sent"), "email");
  assert.equal(evidenceKind("ghl", "Text message sent"), "text");
  assert.equal(evidenceKind("ghl", "Text message received"), "text");
  assert.equal(evidenceKind("ghl", "Opportunity open"), "context");
  assert.equal(evidenceKind("github", "Pull request merged"), "github");
  assert.equal(evidenceKind("worktivity", "Worktivity screenshot context"), "worktivity");
  assert.equal(evidenceKind("ghl", "Something else"), "other");
});

test("keeps casing, surrounding whitespace, and unknown sources sane", () => {
  assert.equal(evidenceKind(" GHL ", "  CALL OUTBOUND  "), "call");
  assert.equal(evidenceKind("", "Email sent"), "email");
  assert.equal(evidenceKind("loom", "Walkthrough"), "other");
});

test("groups kinds into the page's filters", () => {
  assert.equal(evidenceKindBucket("call"), "calls");
  assert.equal(evidenceKindBucket("email"), "emails");
  assert.equal(evidenceKindBucket("text"), "texts");
  assert.equal(evidenceKindBucket("github"), "work");
  assert.equal(evidenceKindBucket("worktivity"), "work");
  assert.equal(evidenceKindBucket("context"), "context");
  assert.equal(evidenceKindBucket("other"), "context");
});

test("labels every kind for the record and the API summary", () => {
  assert.equal(evidenceKindLabel("call"), "Call");
  assert.equal(evidenceKindLabel("email"), "Email");
  assert.equal(evidenceKindLabel("text"), "Text");
  assert.equal(evidenceKindLabel("context"), "Context");
  assert.equal(evidenceKindLabel("github"), "GitHub");
  assert.equal(evidenceKindLabel("worktivity"), "Worktivity frame");
  assert.equal(evidenceKindLabel("other"), "Evidence");
});
