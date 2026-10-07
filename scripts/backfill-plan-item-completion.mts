/**
 * One-time backfill: selected plan items whose task is already completed were
 * left at completion_state "open" (nothing advanced the field), so commitment
 * metrics read zero. This marks them completed with the task's completion time.
 *
 * Dry-run by default; pass --apply to write.
 *   node --import tsx scripts/backfill-plan-item-completion.mts
 *   node --import tsx scripts/backfill-plan-item-completion.mts --apply
 */
import { createAdminClient } from "@/lib/supabase/admin";

const apply = process.argv.includes("--apply");
const target = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
try { console.log(`target host: ${new URL(target).host}`); } catch { console.log("target host: (unresolved)"); }
const db = createAdminClient();

interface ItemRow {
  id: string;
  task_id: string | null;
  completion_state: string | null;
}

async function main() {
  const { data: items, error } = await db
    .from("work_daily_plan_items")
    .select("id,task_id,completion_state")
    .eq("disposition", "selected")
    .not("task_id", "is", null)
    .limit(5000);
  if (error) throw new Error(`load plan items: ${error.message}`);
  const rows = (items ?? []) as ItemRow[];
  const open = rows.filter((row) => String(row.completion_state ?? "open") !== "completed");
  console.log(`plan items with a task: ${rows.length}; open: ${open.length}`);

  const taskIds = [...new Set(open.map((row) => String(row.task_id)))];
  const completedAt = new Map<string, string | null>();
  for (let index = 0; index < taskIds.length; index += 200) {
    const batch = taskIds.slice(index, index + 200);
    const { data: tasks, error: taskError } = await db
      .from("work_tasks")
      .select("id,completed,completed_at")
      .in("id", batch);
    if (taskError) throw new Error(`load tasks: ${taskError.message}`);
    for (const task of (tasks ?? []) as Array<Record<string, unknown>>) {
      if (task.completed === true) completedAt.set(String(task.id), task.completed_at ? String(task.completed_at) : null);
    }
  }

  const updates = open.filter((row) => completedAt.has(String(row.task_id)));
  console.log(`plan items to mark completed: ${updates.length}`);
  if (!apply) {
    console.log("dry run — pass --apply to write");
    return;
  }
  let written = 0;
  for (let index = 0; index < updates.length; index += 200) {
    const batch = updates.slice(index, index + 200);
    const { error: updateError } = await db
      .from("work_daily_plan_items")
      .update({ completion_state: "completed", completed_at: null, updated_at: new Date().toISOString() })
      .in("id", batch.map((row) => row.id));
    if (updateError) throw new Error(`update plan items: ${updateError.message}`);
    written += batch.length;
  }
  // Stamp the task's completion time where it is known, one batch at a time.
  for (const [taskId, at] of completedAt) {
    if (!at) continue;
    const ids = updates.filter((row) => String(row.task_id) === taskId).map((row) => row.id);
    if (!ids.length) continue;
    const { error: stampError } = await db
      .from("work_daily_plan_items")
      .update({ completed_at: at })
      .in("id", ids);
    if (stampError) throw new Error(`stamp completion time: ${stampError.message}`);
  }
  console.log(`updated ${written} plan items`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
