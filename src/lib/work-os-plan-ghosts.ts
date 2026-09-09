/** Plan items whose mirrored task is gone must stop presenting live work.
 * The mirror never hard-deletes `work_tasks` — archive/delete tombstone the
 * row — but a daily-plan item keeps referencing the tombstone forever, so the
 * workspace renders an unhittable shell that always fails with
 * "Task unavailable". Tombstone time and every mirror sync now mark those
 * items `disposition='removed'`, which every list surface already filters out. */
import { db } from "@/lib/work-os-internal";

export type PlanItemRef = { id: string; task_id: string | null; disposition: string };

const TOMBSTONED_STATUSES = new Set(["archived", "deleted"]);

/** Items pointing at an archived/deleted/missing task row (outcome items and
 * already-removed items are never ghosts). */
export function ghostPlanItemIds(items: readonly PlanItemRef[], taskStatusById: ReadonlyMap<string, string>): string[] {
  return items
    .filter((item) => !!item.task_id && item.disposition !== "removed")
    .filter((item) => {
      const status = taskStatusById.get(String(item.task_id));
      return status === undefined || TOMBSTONED_STATUSES.has(status);
    })
    .map((item) => item.id);
}

/** DB wiring lives here so both the tombstone path and the mirror sync share it. */
export async function removePlanItemsForTombstonedTask(taskLocalId: string) {
  const result = await db().from("work_daily_plan_items").update({
    disposition: "removed",
    updated_at: new Date().toISOString(),
  }).eq("task_id", taskLocalId).not("disposition", "eq", "removed").select("id");
  if (result.error) throw new Error(`remove plan items for tombstoned task: ${result.error.message}`);
  return ((result.data ?? []) as Array<Record<string, unknown>>).length;
}

export async function sweepTombstonedPlanItems(userId: string) {
  const tombstoned = await db().from("work_tasks").select("id").eq("user_id", userId).in("status", ["archived", "deleted"]);
  if (tombstoned.error) throw new Error(`load tombstoned tasks for plan sweep: ${tombstoned.error.message}`);
  const tombstonedIds = ((tombstoned.data ?? []) as Array<Record<string, unknown>>).map((row) => String(row.id));
  if (!tombstonedIds.length) return { swept: 0 };
  const candidates = await db().from("work_daily_plan_items")
    .select("id,task_id,disposition")
    .in("task_id", tombstonedIds)
    .not("disposition", "eq", "removed");
  if (candidates.error) throw new Error(`load plan items for tombstone sweep: ${candidates.error.message}`);
  const ghostIds = ghostPlanItemIds((candidates.data ?? []) as PlanItemRef[], new Map(tombstonedIds.map((id) => [id, "archived"])));
  if (!ghostIds.length) return { swept: 0 };
  let swept = 0;
  for (let offset = 0; offset < ghostIds.length; offset += 50) {
    const batch = ghostIds.slice(offset, offset + 50);
    const result = await db().from("work_daily_plan_items").update({
      disposition: "removed",
      updated_at: new Date().toISOString(),
    }).in("id", batch).select("id");
    if (result.error) throw new Error(`sweep plan items: ${result.error.message}`);
    swept += batch.length;
  }
  return { swept };
}
