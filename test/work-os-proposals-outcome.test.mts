import assert from "node:assert/strict";
import test from "node:test";
import { proposalOutcome } from "../src/lib/work-os-proposals";

test("proposal outcomes map every stored status explicitly", () => {
  assert.equal(proposalOutcome("applied"), "applied");
  assert.equal(proposalOutcome("rejected"), "rejected");
  assert.equal(proposalOutcome("applying"), "applying");
  assert.equal(proposalOutcome("stale"), "stale");
  assert.equal(proposalOutcome("failed"), "failed");
  assert.equal(proposalOutcome("needs_review"), "needs_review");
  assert.equal(proposalOutcome("pending"), "pending");
});

test("unknown or missing statuses never masquerade as applied", () => {
  assert.equal(proposalOutcome(undefined), "unknown");
  assert.equal(proposalOutcome(null), "unknown");
  assert.equal(proposalOutcome(""), "unknown");
  assert.equal(proposalOutcome("some_future_status"), "some_future_status");
  assert.notEqual(proposalOutcome("applying"), "applied");
});
