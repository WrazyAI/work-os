#!/usr/bin/env node
/** Protected GHL connection provisioning.
 *
 * Dry by default. `--apply` requires `--confirm-host <resolved-db-host>` and
 * writes only the additive GHL connection/credential/audit rows. The connection
 * starts disabled unless `--enable` is also supplied; enabling still needs an
 * operator who has completed the read-only probe and activation readback.
 *
 * Usage:
 *   node --import tsx scripts/configure-ghl-evidence.mts \
 *     --organization-id <uuid> --location-id <id> \
 *     --credential-file <protected-path> \
 *     [--confirm-host <db-host>] [--apply] [--enable]
 */
import { readFileSync, existsSync } from "node:fs";
import { getPool } from "../src/lib/db/pool";
import { encryptProviderSecret } from "../src/lib/work-os-secrets";

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const organizationId = arg("--organization-id");
const locationId = arg("--location-id");
const credentialFile = arg("--credential-file");
const confirmHost = arg("--confirm-host");
const apply = process.argv.includes("--apply");
const enable = process.argv.includes("--enable");

if (!organizationId || !/^[0-9a-f-]{36}$/i.test(organizationId)) throw new Error("--organization-id must be a UUID");
if (!locationId || !/^[A-Za-z0-9_-]{6,120}$/.test(locationId)) throw new Error("--location-id is required");
if (!credentialFile || !existsSync(credentialFile)) throw new Error("--credential-file must point to a protected file");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const host = new URL(connectionString).hostname;

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry_run",
  organizationId,
  locationId,
  databaseHost: host,
  active: apply && enable,
  writes: apply ? ["work_provider_connections", "work_provider_credentials", "work_audit_log"] : [],
  credentialBytesPrinted: false,
}, null, 2));

if (!apply) process.exit(0);
if (confirmHost !== host) {
  throw new Error("--confirm-host must exactly match the resolved database host before any write");
}
if (enable && !process.argv.includes("--confirm-activation")) {
  throw new Error("--enable requires --confirm-activation after the probe, mapping and retention/AI readback");
}

const token = readFileSync(credentialFile, "utf8").trim();
if (token.length < 20) throw new Error("the credential file does not contain a plausible token");
const cipher = encryptProviderSecret(token);
const pool = getPool();
const client = await pool.connect();
try {
  await client.query("begin");
  const connection = await client.query(
    `insert into work_provider_connections
      (organization_id, provider, external_workspace_id, config, active, updated_at)
     values ($1,'ghl',$2,$3,$4,now())
     on conflict (provider, external_workspace_id) do update set
       organization_id = excluded.organization_id,
       config = excluded.config,
       active = excluded.active,
       updated_at = now()
     returning id`,
    [organizationId, locationId, JSON.stringify({ mode: "pit_polling" }), enable],
  );
  const connectionId = String(connection.rows[0].id);
  await client.query(
    `insert into work_provider_credentials (organization_id, provider, access_token_cipher, updated_at)
     values ($1,'ghl',$2,now())
     on conflict (organization_id, provider) do update set
       access_token_cipher = excluded.access_token_cipher,
       updated_at = now()`,
    [organizationId, cipher],
  );
  await client.query(
    `insert into work_audit_log (organization_id, actor_user_id, action, target_type, target_id, metadata)
     values ($1,null,'provider_connection.ghl_configured','provider_connection',$2,$3)`,
    [organizationId, connectionId, JSON.stringify({ locationId, active: enable, mode: "pit_polling" })],
  );
  await client.query("commit");
  console.log(JSON.stringify({ ok: true, connectionId, active: enable, credentialUpdated: true }, null, 2));
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end().catch(() => {});
}
