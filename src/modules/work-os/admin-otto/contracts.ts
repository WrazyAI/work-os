/** Shared wire contracts only. Safe for companion type-only imports. */
export type OttoScope = { userId: string; organizationId: string; mode: "admin" | "employee" };
export type PersonRef = { id: string; displayName: string; active: boolean; timezone: string };
export type Target = { kind: "team" }
  | { kind: "names"; names: string[] }
  | { kind: "ids"; ids: string[] }
  /** The people the server already resolved for this conversation. Used only
   * for a pronoun or follow-up, never for a new name. */
  | { kind: "context" };
export type Resolution = { kind: "resolved"; people: PersonRef[] }
  | { kind: "missing"; name: string }
  | { kind: "ambiguous"; name: string; choices: PersonRef[] };
export type Page<T> = { items: T[]; nextCursor: string | null; total: number; asOf: string; coverage: string[] };
export type SpeechLine = { text: string; time: string | null };
export type ReviewedRecap = {
  intervalId: string; eventId: string; person: PersonRef; reviewVersion: number;
  reviewKey: string; sourceRevision: number; scriptHash: string;
  reviewStatus: "confirmed" | "amended"; reviewedAt: string;
  windowStart: string; windowEnd: string; timezone: string;
  original: { headline: string; detail: string; activities: string[] };
  employeeFeedback: string | null; speechLines: SpeechLine[]; coverage: string[];
  /** The same-app administration record for this reviewed recap, when the
   * server read provides it. */
  recordUrl?: string;
};
export type FollowSettings = { mode: "all" | "selected"; personIds: string[]; revision: number; activated: boolean };
export type InboxItem = { deliveryId: string; recap: ReviewedRecap; seenAt: string | null; listenedAt: string | null };
export type InboxPage = Page<InboxItem> & { unread: number; catchupPending: boolean };
export type DeliveryLease = { token: string; expiresAt: string; eventIds: string[]; pendingCount: number };
export type TaskCard = {
  id: string; title: string; assignees: PersonRef[]; parentId: string | null;
  parentTitle?: string | null;
  createdDate: string | null; effectiveDueDate: string | null;
  status: "open" | "overdue"; recordUrl: string;
};
export type LocalWindow = { personId: string; timezone: string; from: string; through: string };
export type WorkRecord = { id: string; personId: string; source: "update" | "submitted_eod" | "task" | "reviewed_recap" | "workday";
  occurredAt: string | null; localDate: string; text: string; recordUrl: string };
export type AdminRecordAction = "records" | "reports" | "eods";
export type ReadIntent = { action: "unfinished" | AdminRecordAction | "recaps" | "read_recap" | "workday";
  target: Target; date: string | null; from: string | null; through: string | null;
  relativeDay: "today" | "yesterday" | "this_week" | "last_week" | null;
  overdueOnly: boolean; latest: boolean };
export type AdminRead = { kind: "tasks"; page: Page<TaskCard>; people: PersonRef[] }
  | { kind: "records"; page: Page<WorkRecord>; windows: LocalWindow[]; people?: PersonRef[] }
  | { kind: "recaps"; page: Page<ReviewedRecap> }
  | { kind: "recap"; recap: ReviewedRecap }
  | { kind: "resolution"; resolution: Exclude<Resolution, { kind: "resolved" }> };
export type AdminOttoOperationAction =
  | "assign_task"
  | "delegate_task"
  | "add_contributor"
  | "remove_contributor"
  | "create_task"
  | "complete_task"
  | "reopen_task";

/** One requested mutation. The model never executes it: the server resolves the
 * task and people, stores a preview, and returns that preview for the
 * administrator to confirm. */
export type AdminOttoOperation = {
  action: AdminOttoOperationAction;
  task_query: string | null;
  person_names: string[];
  title: string | null;
  due_date: string | null;
};

export type AdminOttoPendingAction = {
  previewId: string;
  action: string;
  summary: string;
  changes: Array<{ field: string; from: unknown; to: unknown }>;
  warnings: string[];
  expiresAt: string;
  display?: { title: string; assignees: PersonRef[]; changes: Array<{ label: string; before: string | null; after: string | null }> };
  status?: "pending" | "recorded" | "expired" | "in_flight" | "abandoned" | "unknown";
  recordUrl?: string;
};

export type AdminOttoPlanStep = {
  intent: ReadIntent | null;
  operation: AdminOttoOperation | null;
  /** Zero-based index of an earlier prerequisite, never a model-created ID. */
  depends_on: number | null;
};
export type AdminOttoStepView = {
  index: number;
  label: string;
  status: "ready" | "blocked" | "failed" | "recorded";
  result?: AdminRead | null;
  pendingAction?: AdminOttoPendingAction;
  message?: string;
};
export type AdminOttoWorkflowView = { id: string; steps: AdminOttoStepView[] };

export type ChatRequest = { conversationId: string | null; requestId: string; text: string;
  choicePersonId?: string; continuation?: string };
export type ChatResult = { conversationId: string; turnId: string; reply: string; result: AdminRead | null;
  pendingAction?: AdminOttoPendingAction;
  workflow?: AdminOttoWorkflowView;
  contextVersion: number; errorCode?: "unsupported" | "ambiguous" | "missing" };
