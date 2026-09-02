import {
  getNiftyTask,
  listNiftyTasks,
  normalizeNiftyTaskPayload,
} from "@/lib/integrations/nifty";
import { db, ensureNoError, niftyForOwner, niftyIdentity } from "@/lib/work-os-internal";
import { upsertNiftyTask } from "@/lib/work-os-nifty";
import { listPersonTasks } from "@/lib/work-os-tasks";

async function forEachConcurrent<T>(items: T[], concurrency: number, run: (item: T) => Promise<unknown>) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await run(item);
    }
  }));
}

/** Refresh only the Nifty slice that can affect one employee's workspace. */
export async function syncNiftyPersonTasks(userId: string, personId: string) {
  const person = await ensureNoError(
    db().from("work_people").select("nifty_member_id").eq("user_id", userId).eq("id", personId).maybeSingle(),
    "load employee Nifty identity",
  );
  const niftyMemberId = person?.nifty_member_id as string | null | undefined;
  if (!niftyMemberId) throw new Error("Employee Nifty mapping is required for provider refresh");
  const currentRows = await listPersonTasks(userId, personId, { limit: 1000, includeCompleted: true, includeLedgerHistory: true });
  const currentProviderIds = new Set(currentRows.map((task) => String(task.provider_task_id ?? "")).filter(Boolean));
  const tasks = [] as Awaited<ReturnType<typeof listNiftyTasks>>["tasks"];
  const seen = new Set<string>();
  const pageSize = 100;
  for (let offset = 0; offset < 10_000; offset += pageSize) {
    const page = await niftyForOwner(userId, () => listNiftyTasks({ limit: String(pageSize), offset: String(offset), include_subtasks: "true", include_archived: "false" }));
    const fresh = page.tasks.filter((task) => !seen.has(task.id));
    fresh.forEach((task) => seen.add(task.id));
    tasks.push(...fresh);
    if (page.hasMore === false || (page.hasMore !== true && page.tasks.length < pageSize) || !fresh.length) break;
  }
  const relevant = tasks.filter((task) => {
    if (currentProviderIds.has(task.id) || task.assignees.includes(niftyMemberId)) return true;
    const raw = task.raw && typeof task.raw === "object" ? task.raw as Record<string, unknown> : {};
    const creatorIds = [niftyIdentity(raw.created_by), niftyIdentity(raw.creator)];
    const subscriberIds = Array.isArray(raw.subscribers) ? raw.subscribers.map(niftyIdentity) : [];
    return [...creatorIds, ...subscriberIds].includes(niftyMemberId);
  });
  await forEachConcurrent(relevant, 8, (task) => upsertNiftyTask(userId, task));
  return { scanned: tasks.length, tasks: relevant.length, syncedAt: new Date().toISOString() };
}

/** Refresh one provider task before an employee reads or changes it. Nifty is
 * authoritative for assignment and task state; the local row is only a mirror. */
export async function syncNiftyTask(userId: string, providerTaskId: string) {
  const payload = await niftyForOwner(userId, () => getNiftyTask(providerTaskId));
  const task = normalizeNiftyTaskPayload(payload);
  if (!task || task.id === "unknown") throw new Error("Nifty task not found");
  return upsertNiftyTask(userId, task);
}
