import { createHash } from "node:crypto";

export type WorkspaceTaskOrder =
  | "title_asc"
  | "title_desc"
  | "due_asc"
  | "due_desc"
  | "status_asc"
  | "status_desc"
  | "recency";

export type WorkspaceTaskCursor = {
  version: 1;
  scope: string;
  order: WorkspaceTaskOrder;
  sortDate: string;
  id: string;
  title: string;
  completed: boolean;
  dueMissing: boolean;
  dueDate: string;
  recency: string;
  statusRank: number;
  overdueFirst: boolean;
  overdueRank: number;
  position: number;
};

export function taskPageScope(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stamp(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "1970-01-01T00:00:00.000Z" : value.toISOString();
  if (typeof value !== "string") return "1970-01-01T00:00:00.000Z";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "1970-01-01T00:00:00.000Z";
}

export function workspaceTaskCursorForRow(
  task: Record<string, any>,
  input: { scope: string; order: WorkspaceTaskOrder; sortDate: string; position: number; overdueFirst?: boolean },
): WorkspaceTaskCursor {
  const completed = task.completed === true;
  const due = typeof task.due_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(task.due_date)
    ? task.due_date.slice(0, 10)
    : null;
  const overdueRank = completed ? 3 : due && due < input.sortDate ? 0 : 1;
  const cursor: WorkspaceTaskCursor = {
    version: 1,
    ...input,
    overdueFirst: input.overdueFirst === true,
    id: String(task.id ?? ""),
    title: String(task.title ?? "").toLowerCase(),
    completed,
    dueMissing: due === null,
    dueDate: due ?? "9999-12-31",
    recency: stamp(task.provider_updated_at ?? task.provider_created_at ?? task.created_at ?? task.updated_at),
    statusRank: completed ? 2 : due && due < input.sortDate ? 0 : 1,
    overdueRank,
  };
  return cursor;
}

export function createWorkspaceTaskCursor(
  task: Record<string, any>,
  input: { scope: string; order: WorkspaceTaskOrder; sortDate: string; position: number; overdueFirst?: boolean },
) {
  return Buffer.from(JSON.stringify(workspaceTaskCursorForRow(task, input)), "utf8").toString("base64url");
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRecency(left: string, right: string) {
  return compareText(right, left);
}

/** Compare a candidate row to a cursor using the same stable key order as SQL. */
export function compareWorkspaceTaskCursor(task: Record<string, any>, cursor: WorkspaceTaskCursor) {
  const completed = task.completed === true;
  const due = typeof task.due_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(task.due_date)
    ? task.due_date.slice(0, 10)
    : null;
  const title = String(task.title ?? "").toLowerCase();
  const recency = stamp(task.provider_updated_at ?? task.provider_created_at ?? task.created_at ?? task.updated_at);
  const statusRank = completed ? 2 : due && due < cursor.sortDate ? 0 : 1;
  const overdueRank = completed ? 3 : due && due < cursor.sortDate ? 0 : 1;
  if (cursor.overdueFirst) {
    const overdue = overdueRank - cursor.overdueRank;
    if (overdue) return overdue;
  }
  const id = String(task.id ?? "");
  const dueMissing = due === null;
  const dueDate = due ?? "9999-12-31";
  const compareDue = (direction: "asc" | "desc") => {
    const missing = Number(dueMissing) - Number(cursor.dueMissing);
    if (missing) return missing;
    const date = compareText(dueDate, cursor.dueDate) * (direction === "asc" ? 1 : -1);
    if (date) return date;
    return compareRecency(recency, cursor.recency) || compareText(title, cursor.title) || compareText(id, cursor.id);
  };

  switch (cursor.order) {
    case "title_asc": return compareText(title, cursor.title) || compareRecency(recency, cursor.recency) || compareText(id, cursor.id);
    case "title_desc": return compareText(cursor.title, title) || compareRecency(recency, cursor.recency) || compareText(id, cursor.id);
    case "due_asc": return Number(completed) - Number(cursor.completed) || compareDue("asc");
    case "due_desc": return Number(completed) - Number(cursor.completed) || compareDue("desc");
    case "status_asc": return statusRank - cursor.statusRank || compareDue("asc");
    case "status_desc": return cursor.statusRank - statusRank || compareDue("asc");
    case "recency": return compareRecency(recency, cursor.recency) || compareText(title, cursor.title) || compareText(id, cursor.id);
  }
}

export function compareWorkspaceTasks(
  left: Record<string, any>,
  right: Record<string, any>,
  order: WorkspaceTaskOrder,
  sortDate: string,
  overdueFirst = false,
) {
  return compareWorkspaceTaskCursor(left, workspaceTaskCursorForRow(right, {
    scope: "",
    order,
    sortDate,
    position: 0,
    overdueFirst,
  }));
}

export function parseWorkspaceTaskCursor(value: string | null | undefined, expectedScope: string): WorkspaceTaskCursor | null {
  if (!value) return null;
  if (value.length > 4096) throw new Error("Task cursor must be valid and match the current filters");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<WorkspaceTaskCursor>;
    const validOrder = ["title_asc", "title_desc", "due_asc", "due_desc", "status_asc", "status_desc", "recency"]
      .includes(String(parsed.order));
    if (
      parsed.version !== 1
      || parsed.scope !== expectedScope
      || !validOrder
      || typeof parsed.sortDate !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.sortDate)
      || typeof parsed.id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)
      || typeof parsed.title !== "string"
      || typeof parsed.completed !== "boolean"
      || typeof parsed.dueMissing !== "boolean"
      || typeof parsed.dueDate !== "string"
      || typeof parsed.recency !== "string"
      || !Number.isInteger(parsed.statusRank)
      || typeof parsed.overdueFirst !== "boolean"
      || !Number.isInteger(parsed.overdueRank)
      || !Number.isInteger(parsed.position)
      || Number(parsed.position) < 0
    ) throw new Error("invalid shape");
    return parsed as WorkspaceTaskCursor;
  } catch {
    throw new Error("Task cursor must be valid and match the current filters");
  }
}
