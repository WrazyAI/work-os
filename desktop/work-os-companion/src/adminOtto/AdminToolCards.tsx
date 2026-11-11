import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { AdminOttoPendingAction, AdminRead, Page, PersonRef, ReviewedRecap, WorkRecord } from "../../../../src/modules/work-os/admin-otto/contracts";
import { AdminRecapView, type AdminRecapPlayback } from "./AdminRecapView";
import { adminCalendarDate, adminRecapDate, adminReviewStatusLabel } from "./labels";
import { safeAdminRecordHref } from "./recordLinks";
import { ChatMarkdown } from "../ChatMarkdown";
import "./admin-tool-cards.css";

/** Local compatibility seam; older previews deliberately do not expose ID diffs. */
export type AdminToolAction = AdminOttoPendingAction & {
  display?: { title: string; assignees: PersonRef[]; changes: Array<{ label: string; before: string | null; after: string | null }> };
  status?: "pending" | "recorded" | "expired" | "in_flight" | "abandoned" | "unknown";
  recordUrl?: string;
};

function RecordLink({ url, children, onOpenRecord }: { url: string; children: ReactNode; onOpenRecord?: (url: string) => void }) {
  const href = safeAdminRecordHref(url);
  return href && onOpenRecord
    ? <a href={href} onClick={(event) => { event.preventDefault(); onOpenRecord(href); }}>{children}</a>
    : <span>{children}</span>;
}

const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
function ReadFrame({ title, page, children, onLoadMore }: { title: string; page: Page<unknown>; children: ReactNode; onLoadMore?: (token: string) => void }) {
  return <section className="admin-tool-card" aria-label={title}>
    <header className="admin-tool-head"><h4>{title}</h4><span className="admin-tool-state">Read only</span></header>
    <div className="admin-tool-body">{children}</div>
    <footer className="admin-tool-footer">
      <span className="admin-tool-meta" role="status">Showing {page.items.length} of {count(page.total)}</span>
      {page.nextCursor ? <button type="button" disabled={!onLoadMore} onClick={() => onLoadMore?.(page.nextCursor!)}>Load more</button> : null}
      {page.asOf ? <span className="admin-tool-meta admin-tool-asof">As of {adminRecapDate(page.asOf, "UTC")}</span> : null}
    </footer>
    {page.coverage.length ? <details className="admin-tool-coverage"><summary>Source coverage</summary><ul>{page.coverage.map((line, i) => <li key={i}>{line}</li>)}</ul></details> : null}
  </section>;
}

const sourceLabels: Record<WorkRecord["source"], string> = {
  update: "Employee update", submitted_eod: "EOD report", task: "Task", reviewed_recap: "Reviewed recap", workday: "Workday",
};
type NamedRecord = WorkRecord & { person?: Pick<PersonRef, "displayName">; personDisplayName?: string; displayName?: string };

export type AdminReadCardProps = {
  result: AdminRead; onOpenRecord: (url: string) => void; onOpenRecap: (recap: ReviewedRecap) => void;
  onListen: (recap: ReviewedRecap) => void; playback?: AdminRecapPlayback | null;
  onChoosePerson?: (id: string) => void; onLoadMore?: (token: string) => void;
};

export function AdminReadCard({ result, onOpenRecord, onOpenRecap, onListen, playback = null, onChoosePerson, onLoadMore }: AdminReadCardProps) {
  if (result.kind === "recap") return <AdminRecapView recap={result.recap} onListen={onListen} onOpenRecord={onOpenRecord} playback={playback} />;
  if (result.kind === "resolution") {
    const resolution = result.resolution;
    return <section className="admin-tool-card" aria-label="Person needed">
      <header className="admin-tool-head"><h4>{resolution.kind === "ambiguous" ? "Which person?" : "Person not found"}</h4></header>
      <div className="admin-tool-body">
        <p>{resolution.kind === "missing" ? `No employee named ${resolution.name} was found. Check the name and ask again.` : `More than one person matches ${resolution.name}. Choose the person you mean.`}</p>
        {resolution.kind === "ambiguous" ? <ul className="admin-tool-rows">{resolution.choices.map((person) => <li key={person.id}>
          {onChoosePerson ? <button type="button" className="admin-tool-person" aria-label={`Choose ${person.displayName}`} onClick={() => onChoosePerson(person.id)}>{person.displayName}<span className="admin-tool-meta">{person.timezone}{!person.active ? " · Inactive" : ""}</span></button> : <strong>{person.displayName}</strong>}
        </li>)}</ul> : null}
      </div>
    </section>;
  }
  if (result.kind === "tasks") return <ReadFrame title="Tasks" page={result.page} onLoadMore={onLoadMore}>
    {result.page.items.length ? <ol className="admin-tool-rows">{result.page.items.map((task) => <li key={task.id} className="admin-tool-row">
      <div className="admin-tool-main"><strong className="admin-tool-title"><RecordLink url={task.recordUrl} onOpenRecord={onOpenRecord}>{task.title}</RecordLink></strong>
        <p className="admin-tool-meta">{task.assignees.map((person) => person.displayName || "Unnamed teammate").join(", ") || "Unassigned"}</p>
        {task.parentTitle || task.parentId ? <p className="admin-tool-meta">Subtask of {task.parentTitle || "a parent task"}</p> : null}
        {task.effectiveDueDate ? <p className="admin-tool-meta">Due {adminCalendarDate(task.effectiveDueDate)}</p> : null}
      </div><span className={`admin-tool-state${task.status === "overdue" ? " is-attention" : ""}`}>{task.status === "overdue" ? "Overdue" : "Open"}</span>
    </li>)}</ol> : <p>No tasks matched that request. Try another person or date range.</p>}
  </ReadFrame>;
  if (result.kind === "records") {
    const people = (result as typeof result & { people?: PersonRef[] }).people ?? [];
    return <ReadFrame title="Work records" page={result.page} onLoadMore={onLoadMore}>
      {result.page.items.length ? <ol className="admin-tool-rows">{result.page.items.map((entry) => {
        const record = entry as NamedRecord;
        const name = record.person?.displayName || record.personDisplayName || record.displayName || people.find((person) => person.id === record.personId)?.displayName || "Team member";
        const timezone = result.windows.find((window) => window.personId === record.personId)?.timezone;
        return <li key={record.id}><article className={`admin-tool-record admin-tool-record--${record.source}`}>
          <header><strong>{name}</strong><span className="admin-tool-meta">{sourceLabels[record.source]}</span></header>
          <p className="admin-tool-meta"><time dateTime={record.localDate}>{adminCalendarDate(record.localDate)}</time>{timezone ? ` · ${timezone}` : ""}</p>
          {record.source === "submitted_eod" ? <div className="admin-tool-document"><h5>Submitted report</h5><ChatMarkdown text={record.text || "No report text available."} /></div>
            : record.source === "update" ? <blockquote>{record.text || "No update text available."}</blockquote>
              : record.source === "workday" ? <dl className="admin-tool-workday"><dt>Day record</dt><dd>{record.text || "No day details available."}</dd></dl>
                : <p className="admin-tool-excerpt">{record.text || sourceLabels[record.source]}</p>}
          <RecordLink url={record.recordUrl} onOpenRecord={onOpenRecord}>Open {record.source === "submitted_eod" ? "report" : record.source === "workday" ? "workday" : "record"}</RecordLink>
        </article></li>;
      })}</ol> : <p>No records matched that request. Try another person or date range.</p>}
    </ReadFrame>;
  }
  return <ReadFrame title="Reviewed recaps" page={result.page} onLoadMore={onLoadMore}>
    {result.page.items.length ? <ol className="admin-tool-rows">{result.page.items.map((recap) => {
      const active = playback?.intervalId === recap.intervalId && (playback.status === "playing" || playback.status === "loading");
      return <li key={recap.intervalId} className="admin-tool-recap-row">
        <strong>{recap.person.displayName}</strong><p className="admin-tool-meta">{adminReviewStatusLabel(recap.reviewStatus)} · {adminRecapDate(recap.reviewedAt, recap.timezone)}</p>
        {recap.original.headline ? <p className="admin-tool-excerpt">{recap.original.headline}</p> : null}
        <div className="admin-tool-actions"><button type="button" data-admin-recap-id={recap.intervalId} data-admin-recap-action="view" onClick={() => onOpenRecap(recap)}>View recap</button>
          <button type="button" aria-label={`${active ? "Stop reading" : "Listen to"} the recap for ${recap.person.displayName}`} aria-pressed={active} onClick={() => onListen(recap)}>{active ? "Stop" : "Listen"}</button></div>
      </li>;
    })}</ol> : <p>No reviewed recaps matched that request. Try another person or date range.</p>}
  </ReadFrame>;
}

type ActionRow = { action: AdminToolAction; selected: boolean; busy: boolean; message: string | null };
const statusOf = (action: AdminToolAction): NonNullable<AdminToolAction["status"]> => {
  if (action.status && action.status !== "pending") return action.status;
  const expiry = Date.parse(action.expiresAt);
  return !Number.isFinite(expiry) || expiry <= Date.now() ? "expired" : "pending";
};
function failureState(cause: unknown): { status: NonNullable<AdminToolAction["status"]>; message: string } {
  const error = cause && typeof cause === "object" ? cause as { reason?: unknown; code?: unknown } : {};
  const reason = typeof error.reason === "string" ? error.reason : typeof error.code === "string" ? error.code : "";
  if (/stale|expired/.test(reason)) return { status: "expired", message: "This preview is out of date. Ask Otto for a new preview before approving." };
  if (/in_flight|in_progress/.test(reason)) return { status: "in_flight", message: "This change is still being checked. Refresh its status before taking another action." };
  if (/abandoned|cancelled/.test(reason)) return { status: "abandoned", message: "This preview is no longer available. Ask Otto for a new preview." };
  return { status: "unknown", message: "The result is not confirmed. Refresh status before approving again." };
}

/** Real approval state machine shared by the view and tests. All guards are
 * synchronous; a second click cannot get ahead of React's next render. */
export function createAdminActionSession(initial: AdminOttoPendingAction[]) {
  const makeRow = (action: AdminToolAction): ActionRow => ({ action: { ...action, status: statusOf(action) }, selected: statusOf(action) === "pending", busy: false, message: null });
  let rows = initial.map(makeRow);
  const listeners = new Set<() => void>();
  const locks = new Set<string>();
  const settled = new Set<string>();
  const emit = () => { for (const listener of listeners) listener(); };
  const update = (id: string, patch: Partial<ActionRow>) => { rows = rows.map((row) => row.action.previewId === id ? { ...row, ...patch } : row); emit(); };
  const session = {
    snapshot: () => rows,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setActions(actions: AdminOttoPendingAction[]) {
      rows = actions.map((action) => {
        const previous = rows.find((row) => row.action.previewId === action.previewId);
        if (!previous) return makeRow(action);
        if (locks.has(action.previewId) || previous.action.status === "recorded") return previous;
        if ((action as AdminToolAction).status === "recorded") return { ...makeRow(action), selected: false };
        if (settled.has(action.previewId)) return previous;
        return { ...makeRow(action), selected: previous.selected && statusOf(action) === "pending" };
      });
      emit();
    },
    toggle(id: string) {
      const row = rows.find((item) => item.action.previewId === id);
      if (row && !locks.has(id) && statusOf(row.action) === "pending") update(id, { selected: !row.selected });
    },
    async confirmSelected(confirm: (action: AdminOttoPendingAction) => Promise<AdminOttoPendingAction>) {
      const selected = rows.filter((row) => row.selected && !locks.has(row.action.previewId) && statusOf(row.action) === "pending");
      // Reserve the complete batch before the first await, including items later in it.
      for (const row of selected) { locks.add(row.action.previewId); update(row.action.previewId, { busy: true, message: null }); }
      await Promise.all(selected.map(async (row) => {
        const id = row.action.previewId;
        try {
          const response = await confirm(row.action) as AdminToolAction;
          if (response.previewId !== id) throw new Error("Preview mismatch");
          // Legacy confirmation endpoints return the original preview after success.
          const status = response.status === "pending" ? "unknown" : response.status ?? "recorded";
          update(id, { action: { ...row.action, ...response, status }, selected: false, message: null });
        } catch (cause) {
          const failure = failureState(cause);
          update(id, { action: { ...row.action, status: failure.status }, selected: false, message: failure.message });
        } finally {
          settled.add(id); locks.delete(id); update(id, { busy: false });
        }
      }));
    },
    async refresh(id: string, refresh: (action: AdminOttoPendingAction) => Promise<AdminOttoPendingAction>) {
      const row = rows.find((item) => item.action.previewId === id);
      if (!row || locks.has(id) || !["unknown", "in_flight"].includes(statusOf(row.action))) return;
      locks.add(id); update(id, { busy: true });
      try {
        const response = await refresh(row.action) as AdminToolAction;
        if (response.previewId !== id || !response.status) throw new Error("No authoritative status");
        update(id, { action: { ...row.action, ...response }, selected: false, message: null });
      } catch {
        update(id, { message: "Status is unavailable. Refresh status again before approving; do not repeat the change." });
      } finally { locks.delete(id); update(id, { busy: false }); }
    },
  };
  return session;
}

const actionLabels: Record<string, string> = {
  "task.create": "Create task", "task.assign": "Assign task", "task.update": "Update task",
  "task.complete": "Complete task", "task.reopen": "Reopen task", "task.move": "Move task",
  "task.archive": "Archive task", "task.delete": "Delete task",
  create_task: "Create task", assign_task: "Assign task", delegate_task: "Delegate task", add_contributor: "Add contributor",
  remove_contributor: "Remove contributor", complete_task: "Complete task", reopen_task: "Reopen task",
};
function receipt(action: AdminToolAction): string {
  if (statusOf(action) === "recorded") return ({ "task.create": "Task created", "task.assign": "Task assigned", "task.complete": "Task completed", "task.reopen": "Task reopened", create_task: "Task created", assign_task: "Task assigned", delegate_task: "Task delegated", add_contributor: "Contributor added", remove_contributor: "Contributor removed", complete_task: "Task completed", reopen_task: "Task reopened" } as Record<string, string>)[action.action] || "Change recorded";
  return ({ pending: "Awaiting approval", expired: "Preview expired · Ask for a new preview", in_flight: "Checking change · Refresh status", abandoned: "Not applied", unknown: "Result not confirmed · Refresh status" } as Record<string, string>)[statusOf(action)] || "Result not confirmed";
}
function displayChanges(action: AdminToolAction) {
  const supplied = action.display?.changes;
  if (supplied) return supplied.filter((change) => change.before !== change.after && (change.before !== null || change.after !== null)
    && (!["create_task", "task.create"].includes(action.action) || (change.after !== null && !["task", "title", "assignees"].includes(change.label.toLowerCase()))));
  // No unknown structures or ID-bearing fields from older preview payloads.
  const labels: Record<string, string> = { title: "Title", due_date: "Due date", status: "Status" };
  return action.changes.filter((change) => labels[change.field] && change.from !== change.to &&
    (typeof change.from === "string" || change.from === null) && (typeof change.to === "string" || change.to === null))
    .map((change) => ({ label: labels[change.field], before: change.from as string | null, after: change.to as string | null }));
}
const displayValue = (value: string | null) => value === null ? "Not set" : /^\d{4}-\d{2}-\d{2}$/.test(value) ? adminCalendarDate(value) : value;

export type AdminActionBatchProps = {
  actions: AdminOttoPendingAction[];
  onConfirm: (action: AdminOttoPendingAction) => Promise<AdminOttoPendingAction>;
  onRefresh?: (action: AdminOttoPendingAction) => Promise<AdminOttoPendingAction>;
  onOpenRecord?: (url: string) => void;
  onBusyChange?: (busy: boolean) => void;
};

export function AdminActionBatch({ actions, onConfirm, onRefresh, onOpenRecord, onBusyChange }: AdminActionBatchProps) {
  const sessionRef = useRef<ReturnType<typeof createAdminActionSession> | null>(null);
  if (!sessionRef.current) sessionRef.current = createAdminActionSession(actions);
  const session = sessionRef.current;
  const rows = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const previousActions = useRef(actions);
  useEffect(() => { if (previousActions.current !== actions) { previousActions.current = actions; session.setActions(actions); } }, [actions, session]);
  if (!rows.length) return null;
  const pending = rows.filter((row) => statusOf(row.action) === "pending");
  const selected = pending.filter((row) => row.selected);
  const busy = rows.some((row) => row.busy);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const allCreates = selected.length > 0 && selected.every((row) => ["create_task", "task.create"].includes(row.action.action));
  const standalone = rows.length === 1;
  const uniformAction = new Set(rows.map((row) => row.action.action)).size === 1;
  const confirmLabel = standalone ? actionLabels[rows[0].action.action] || "Apply change"
    : allCreates ? `Create ${selected.length} task${selected.length === 1 ? "" : "s"}` : `Apply ${selected.length} change${selected.length === 1 ? "" : "s"}`;
  return <section className="admin-tool-card admin-tool-approval" aria-label="Task change approval">
    <header className="admin-tool-head"><h4>{standalone ? actionLabels[rows[0].action.action] || "Task change" : "Review task changes"}</h4><span className="admin-tool-state">{pending.length ? "Approval required" : "Results"}</span></header>
    <ol className="admin-tool-rows admin-tool-action-list">{rows.map(({ action, selected: checked, busy: working, message }) => {
      const status = statusOf(action);
      const changes = displayChanges(action);
      const title = action.display?.title || action.summary;
      const canRefresh = status === "unknown" || status === "in_flight";
      return <li key={action.previewId} className={`admin-tool-action is-${status}`}>
        <div className="admin-tool-row">
          {!standalone && status === "pending" ? <label className="admin-tool-selection"><input type="checkbox" checked={checked} disabled={working} aria-label={`Include ${title}`} onChange={() => session.toggle(action.previewId)} /></label> : null}
          <div className="admin-tool-main"><strong className="admin-tool-title">{title}</strong>
            {action.display ? <p className="admin-tool-meta">{action.display.assignees.map((person) => person.displayName || "Unnamed teammate").join(", ") || "Unassigned"}</p> : null}
            {!standalone && !uniformAction ? <span className="admin-tool-meta">{actionLabels[action.action] || "Task change"}</span> : null}
          </div>
        </div>
        {changes.length ? <dl className={`admin-tool-diff${["create_task", "task.create"].includes(action.action) ? " is-creation" : ""}`}>{changes.map((change, index) => <div key={index}>
          <dt>{change.label}</dt><dd>{["create_task", "task.create"].includes(action.action) ? displayValue(change.after) : <><span className="admin-tool-before"><span className="admin-tool-sr">Before: </span>{displayValue(change.before)}</span><span aria-hidden="true"> → </span><span className="admin-tool-after"><span className="admin-tool-sr">After: </span>{displayValue(change.after)}</span></>}</dd>
        </div>)}</dl> : null}
        {action.warnings.length ? <ul className="admin-tool-warnings">{action.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
        {status !== "pending" || working || message ? <div className="admin-tool-receipt" role="status"><span>{working ? (canRefresh ? "Refreshing status…" : "Applying…") : receipt(action)}</span>
          {status === "recorded" && action.recordUrl ? <RecordLink url={action.recordUrl} onOpenRecord={onOpenRecord}>Open task</RecordLink> : null}
        </div> : null}
        {message ? <p className="admin-tool-error" role="alert">{message}</p> : null}
        {canRefresh ? onRefresh ? <button type="button" disabled={working} onClick={() => void session.refresh(action.previewId, onRefresh)}>Refresh status<span className="admin-tool-sr"> for {title}</span></button> : <p className="admin-tool-meta">Ask Otto to check this change before trying again.</p> : null}
      </li>;
    })}</ol>
    {pending.length ? <footer className="admin-tool-footer"><span className="admin-tool-meta">{standalone ? "Not applied until you approve." : `${selected.length} of ${pending.length} selected`}</span>
      <button type="button" className="admin-tool-primary" disabled={!selected.length || busy} onClick={() => void session.confirmSelected(onConfirm)}>{busy ? "Applying…" : confirmLabel}</button>
    </footer> : null}
  </section>;
}
