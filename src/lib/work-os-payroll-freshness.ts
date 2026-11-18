import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import type { PayrollScope } from "@/modules/work-os/payroll/contracts";

export const PAYROLL_ZERO_UUID = "00000000-0000-0000-0000-000000000000";

export class PayrollSourceChangedError extends Error {
  readonly code = "payroll_source_changed";
  constructor(message = "Payroll source evidence changed; reload the review before approving.") {
    super(message);
    this.name = "PayrollSourceChangedError";
  }
}

function assertScope(scope: PayrollScope): void {
  if (!/^[0-9a-f-]{36}$/i.test(scope.organizationId) || !/^[0-9a-f-]{36}$/i.test(scope.personId)) {
    throw new Error("Payroll scope identifiers are invalid");
  }
}

async function ensureRows(client: PoolClient, scope: PayrollScope): Promise<void> {
  await client.query(`INSERT INTO work_payroll_source_versions(organization_id,person_id,version)
    VALUES($1,$2,0),($1,$3,0) ON CONFLICT (organization_id,person_id) DO NOTHING`,
  [scope.organizationId, PAYROLL_ZERO_UUID, scope.personId]);
}

/** Reads and locks both source-version rows. A trigger that bumps either row
 * waits behind this transaction, so approval can validate and commit against a
 * coherent historical snapshot. */
export async function loadPayrollSourceToken(client: PoolClient, scope: PayrollScope): Promise<string> {
  assertScope(scope);
  await ensureRows(client, scope);
  const { rows } = await client.query<{ person_id: string; version: string | number }>(`SELECT person_id,version
    FROM work_payroll_source_versions
    WHERE organization_id=$1 AND person_id=ANY($2::uuid[])
    ORDER BY person_id FOR SHARE`, [scope.organizationId, [PAYROLL_ZERO_UUID, scope.personId]]);
  const value = (person: string) => Number(rows.find((row) => row.person_id === person)?.version ?? 0);
  return `${value(PAYROLL_ZERO_UUID)}:${value(scope.personId)}`;
}

/** Lock-free display read for building a manifest; the approval fence uses
 * `loadPayrollSourceToken` instead. */
export async function readPayrollSourceToken(scope: PayrollScope): Promise<string> {
  assertScope(scope);
  const { rows } = await getPool().query<{ person_id: string; version: string | number }>(`SELECT person_id,version
    FROM work_payroll_source_versions
    WHERE organization_id=$1 AND person_id=ANY($2::uuid[])`, [scope.organizationId, [PAYROLL_ZERO_UUID, scope.personId]]);
  const value = (person: string) => Number(rows.find((row) => row.person_id === person)?.version ?? 0);
  return `${value(PAYROLL_ZERO_UUID)}:${value(scope.personId)}`;
}

export async function verifyPayrollSourceToken(client: PoolClient, scope: PayrollScope, expected: string): Promise<void> {
  const current = await loadPayrollSourceToken(client, scope);
  if (current !== expected) throw new PayrollSourceChangedError();
}
