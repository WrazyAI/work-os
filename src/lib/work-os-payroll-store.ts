import type { PoolClient } from "pg";
import { queryOne, withTransaction } from "@/lib/db/typed";
import type { IdRow } from "@/lib/db/rows/payroll";
import type { PayrollScope } from "@/modules/work-os/payroll/contracts";

/** Authorization is the caller's responsibility; composite scope is checked
 * again here so service SQL never treats a person ID as tenant authorization. */
export async function withPayrollTransaction<T>(scope: PayrollScope, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(async (client) => {
    const person = await queryOne<IdRow>(client, "select id from work_people where organization_id=$1 and id=$2", [scope.organizationId, scope.personId]);
    if (!person) throw new Error("Payroll person not found");
    return fn(client);
  });
}

export async function assertPayrollOwner(client: PoolClient, scope: PayrollScope, reviewId: string): Promise<void> {
  const review = await queryOne<IdRow>(client, "select id from work_payroll_reviews where organization_id=$1 and person_id=$2 and id=$3", [scope.organizationId, scope.personId, reviewId]);
  if (!review) throw new Error("Payroll review not found");
}
