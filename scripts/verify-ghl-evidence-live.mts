#!/usr/bin/env node
/** Read-only GoHighLevel evidence probe.
 *
 * Dry by default: it prints the intended read surfaces without a credential or
 * network call. `--live` requires an approved credential file and makes a tiny
 * set of GET requests. It never prints bodies, customer identifiers, tokens, or
 * raw payloads — only endpoint/status/field-presence booleans.
 *
 * Usage:
 *   node --import tsx scripts/verify-ghl-evidence-live.mts \
 *     --organization-id <uuid> --location-id <id> \
 *     --credential-file <protected-path> [--live]
 */
import { readFileSync, existsSync } from "node:fs";
import { createGhlClient } from "../src/lib/work-os-ghl-client";

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function assertId(value: string | null, label: string) {
  if (!value || !/^[A-Za-z0-9_-]{6,120}$/.test(value)) throw new Error(`--${label} is required`);
  return value;
}

const organizationId = arg("--organization-id");
const locationId = assertId(arg("--location-id"), "location-id");
const credentialFile = arg("--credential-file");
const live = process.argv.includes("--live");

if (!organizationId) {
  console.error("--organization-id is required to scope the intended Work OS organization");
  process.exit(1);
}

const endpoints = [
  "GET /locations/{locationId}",
  "GET /users/search",
  "GET /conversations/messages/export (Call, SMS, Email separately)",
  "GET /conversations/messages/email/{id} (content shape only)",
  "GET /calendars",
  "GET /calendars/events (scheduled window)",
  "GET /contacts/{id}/notes",
  "GET /contacts/{id}/tasks",
  "GET /opportunities/search",
];

console.log(JSON.stringify({
  mode: live ? "live_read_only" : "dry_run",
  organizationId,
  locationId,
  intendedSurfaces: endpoints,
  checks: {
    scopes: "CONFIRM_READ_ONLY_SCOPES",
    identityMapping: "OPERATOR_CONFIRMED",
    aiAndRetention: "OPERATOR_CONFIRMED",
    sourceNavigation: "OBSERVE_AND_VALIDATE",
  },
  networkCalls: 0,
  bodiesPrinted: 0,
}, null, 2));

if (!live) process.exit(0);

if (!credentialFile || !existsSync(credentialFile)) {
  console.error("--credential-file must point to a protected file for a live read-only probe");
  process.exit(1);
}
const token = readFileSync(credentialFile, "utf8").trim();
if (!token) {
  console.error("the credential file is empty");
  process.exit(1);
}

const scope = { organizationId, connectionId: "probe", locationId };
const client = createGhlClient({ scope, token });
const results: Array<{ name: string; ok: boolean; status: string }> = [];
async function probe(name: string, run: () => Promise<unknown>) {
  try {
    const value = await run();
    const present = value !== null && value !== undefined && (typeof value !== "object" || Object.keys(value as object).length > 0);
    results.push({ name, ok: present, status: present ? "responded" : "empty" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    const status = /status (\d{3})/.exec(message)?.[1] ?? "error";
    results.push({ name, ok: false, status });
  }
}

await probe("location", () => client.read({ path: `/locations/${encodeURIComponent(locationId)}` }));
await probe("users", () => client.read({ path: "/users/search", query: { locationId } }));
await probe("calendars", () => client.read({ path: "/calendars", query: { locationId } }));

console.log(JSON.stringify({ mode: "live_read_only", results, tokenPrinted: false, bodiesPrinted: false }, null, 2));
