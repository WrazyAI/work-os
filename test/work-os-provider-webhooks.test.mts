import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import {
  githubObservation,
  isEmployeeOutput,
  isValidGithubWebhookSignature,
  isValidGhlWebhookSignature,
  label,
  linkedNiftyTask,
} from "../src/lib/work-os-provider-webhooks";

const raw = JSON.stringify({ action: "closed", number: 42 });
const githubSecret = "test-github-secret";
const githubSignature = `sha256=${createHmac("sha256", githubSecret).update(raw).digest("hex")}`;
assert.equal(isValidGithubWebhookSignature(raw, githubSignature, githubSecret), true);
assert.equal(isValidGithubWebhookSignature(`${raw} `, githubSignature, githubSecret), false);
assert.equal(isValidGithubWebhookSignature(raw, "sha1=wrong", githubSecret), false);
assert.equal(isValidGithubWebhookSignature(raw, null, githubSecret), false);

const merged = githubObservation("pull_request", {
  action: "closed",
  pull_request: {
    title: "Ship evidence",
    number: 42,
    merged: true,
    html_url: "https://github.test/pull/42",
    merged_at: "2026-08-11T10:00:00Z",
  },
});
assert.equal(merged?.title, "Pull request merged: Ship evidence");
assert.match(merged?.summary ?? "", /was merged/);
assert.equal(merged?.occurredAt, "2026-08-11T10:00:00Z");
assert.equal(githubObservation("unsupported", {}), null);

assert.equal(linkedNiftyTask({ pull_request: { body: "https://nifty.pm/acme/tasks/ABC_123" } }), "ABC_123");
assert.equal(linkedNiftyTask({ issue: { body: "Nifty task: task_1234" } }), "task_1234");
assert.equal(linkedNiftyTask({ issue: { body: "No provider task reference" } }), null);

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const ghlRaw = JSON.stringify({ type: "appointmentCreated", id: "evt-1" });
const ghlSignature = sign(null, Buffer.from(ghlRaw), privateKey).toString("base64");
assert.equal(isValidGhlWebhookSignature(ghlRaw, ghlSignature, publicKeyPem), true);
assert.equal(isValidGhlWebhookSignature(`${ghlRaw} `, ghlSignature, publicKeyPem), false);
assert.equal(isValidGhlWebhookSignature(ghlRaw, "not-base64", publicKeyPem), false);
assert.equal(isValidGhlWebhookSignature(ghlRaw, null, publicKeyPem), false);

assert.equal(label("appointmentCreated"), "appointment Created");
assert.equal(label("note_created"), "note created");
assert.equal(isEmployeeOutput("appointmentCreated"), true);
assert.equal(isEmployeeOutput("contactUpdated"), false);
assert.equal(isEmployeeOutput("conversationUpdate"), true);

console.log("Work OS provider webhook tests passed.");
