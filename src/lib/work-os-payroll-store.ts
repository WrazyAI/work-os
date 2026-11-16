import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import type { PayrollScope } from "@/modules/work-os/payroll/contracts";

/** Authorization is the caller's responsibility; composite scope is checked
 * again here so service SQL never treats a person ID as tenant authorization. */
export async function withPayrollTransaction<T>(scope: PayrollScope, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const person = await client.query("select id from work_people where organization_id=$1 and id=$2", [scope.organizationId, scope.personId]);
    if (!person.rows.length) throw new Error("Payroll person not found");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

export async function assertPayrollOwner(client: PoolClient, scope: PayrollScope, reviewId: string): Promise<void> {
  const result = await client.query("select id from work_payroll_reviews where organization_id=$1 and person_id=$2 and id=$3", [scope.organizationId, scope.personId, reviewId]);
  if (!result.rows.length) throw new Error("Payroll review not found");
}
