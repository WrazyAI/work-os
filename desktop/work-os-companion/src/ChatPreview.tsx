import { useState } from "react";
import { SquarePen, X } from "lucide-react";
import { ProgressComposer } from "./App";
import { ChatTabs, ChatTurn, ChatWelcome, ConversationSurface, WorkOsPromptBar, workOsChatCommands } from "./WorkOsChat";
import { NavigateButton } from "./NavigateButton";
import { ApprovalFlow, ApprovalResults } from "./ApprovalFlow";
import { TaskSelectionCard } from "./TaskSelectionCard";
import { NotificationFlyouts } from "./NotificationFlyouts";
import { WhatsNewModal } from "./WhatsNewModal";
import { displayUpdateVersion } from "./updater";
import { changelogHistory, updateInstalledCopy } from "./whatsNew";
import CHANGELOG_RAW from "../CHANGELOG.md?raw";
import { MascotPet } from "./MascotPet";
import { MascotMark } from "./chat/MascotMark";
import { MASCOT } from "./mascot";
import type { ProposedOperation, ToolCallResult } from "./interpretation";
import type { WorkOsConversationTurn } from "./vault";
import { TaskBatchCard } from "./TaskBatchCard";

/** DEV-only visual review surface for the shared chat language
 * (design §25.11): the real in-app ProgressComposer plus a faithful
 * avatar-panel replica built from the same ChatTabs/WorkOsPromptBar
 * primitives. Never shipped; see main.tsx preview routes. */
export default function ChatPreview() {
  const params = new URLSearchParams(window.location.search);
  const isolate = params.get("isolate");
  if (isolate === "avatar") {
    return (
      <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
        <AvatarSection standalone />
      </div>
    );
  }
  if (isolate === "inapp") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 860, padding: 24 }}>
        <InAppSection />
      </div>
    );
  }
  if (isolate === "tools") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 860, padding: 24 }}>
        <InAppToolsSection />
      </div>
    );
  }
  if (isolate === "recovery") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 860, padding: 24 }}>
        <CreateRecoverySection />
      </div>
    );
  }
  if (isolate === "whatsnew") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 860, padding: 24 }}>
        <WhatsNewSection />
      </div>
    );
  }
  if (isolate === "batch") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 860, padding: 24 }}>
        <BatchSection />
      </div>
    );
  }
/** DEV-only: a persisted conversation that contains a stored double-save (the
 * live turn and its persisted twin), used to verify that history renders one
 * turn with its card and that the duplicate heals at render. */
function HistorySection() {
  const operation = { op: "display_pending_tasks" as const, statement: "Show pending.", limit: 5, enabled: false };
  const toolResults = [{
    op: operation,
    status: "recorded" as const,
    message: "Pending tasks loaded.",
    data: { provider_result: { view: "pending" as const, tasks: [
      { id: "t-overdue", title: "Repair provider sync", state: "overdue", due_date: "2026-09-06" },
      { id: "t-today", title: "Ship the avatar review flow", state: "pending", due_date: "2026-09-07" },
    ] } },
  }];
  const assistantTurn = {
    id: "a-history-1",
    role: "assistant" as const,
    text: "Review the selected task completions before anything changes.",
    meta: "tasks shown",
    createdAt: "2026-09-17T18:20:00.000Z",
    operations: [operation],
    toolResults,
  };
  // The recorded-completion shape from production: the filed result carries
  // the proposal row, whose provider_result is jsonb `{}`. It must render the
  // action result alone — never an empty "No pending tasks" card (design §25.9).
  const completionOp = { op: "complete_task" as const, statement: "Employee confirmed completion of Repair provider sync.", taskId: "t-overdue", taskTitle: "Repair provider sync", proposalId: "p-history-1", enabled: false };
  const completionTurn = {
    id: "a-history-3",
    role: "assistant" as const,
    text: "I found the matching task and can propose checking it off for your approval.",
    meta: "1 proposed update",
    createdAt: "2026-09-17T18:21:00.000Z",
    operations: [completionOp],
    toolResults: [{
      op: completionOp,
      status: "recorded" as const,
      message: "Recorded. Provider confirmation follows the normal sync state.",
      data: { provider_result: {}, outcome: "applied" },
    }],
  };
  const composer = {
    input: "", open: true, panel: "update" as const, receipt: null, pending: "", busy: false,
    required: false, goal: "", goalProvenance: null, goalSuggestion: null, saveState: "saved" as const,
    onInput: noop, onOpen: noop, onOpenGoal: noop, onClose: noop, onSubmit: noop,
    onClassify: noop, onGoal: noop, onAcceptSuggestion: noop,
  };
  return (
    <section aria-label="Persisted history preview" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 14 }}>Persisted history with a stored double-save</h2>
      <ProgressComposer
        {...composer}
        history={[
          { id: "u-history-1", role: "user", text: "Can u show me a list of incomplete tasks from my todos?", createdAt: "2026-09-17T18:19:00.000Z" },
          assistantTurn,
          { ...assistantTurn, id: "a-history-2" },
          completionTurn,
        ]}
      />
    </section>
  );
}

  if (isolate === "avatar") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 860, padding: 24 }}>
        <AvatarSection />
      </div>
    );
  }
  if (isolate === "history") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 860, padding: 24 }}>
        <HistorySection />
      </div>
    );
  }
  if (isolate === "composer") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 860, padding: 24 }}>
        <InAppSection />
      </div>
    );
  }
  if (isolate === "tools") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 860, padding: 24 }}>
        <InAppToolsSection />
      </div>
    );
  }
  if (isolate === "orb") {
    return (
      <div style={{ minHeight: 300, padding: 28, background: "#dde3d8" }}>
        <div className="avatar-compact">
          {params.has("prompt") ? <button className="avatar-prompt-bubble"><strong>Quick check-in</strong><span>What changed since your last update?</span></button> : null}
          <span className="avatar-drag-surface" aria-hidden="true">•••</span>
          <button className="avatar-hide" aria-label="Hide companion" title="Hide companion"><X size={13} /></button>
          <button className="avatar-orb" aria-label={`Open ${MASCOT.name} companion`}>
            <MascotPet isolated agent={params.has("prompt") ? "needs-input" : "idle"} workday={params.has("prompt") ? "check-in-due" : "active"} className="avatar-pet" artClassName="avatar-pet-art" />
            <span className="avatar-orb-state">{params.has("prompt") ? "Check in" : "Focused"}</span>
            <span className="avatar-badge" />
          </button>
          <span className="avatar-day-time">3h 12m left</span>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 860, padding: 24 }}>
      <InAppSection />
      <InAppToolsSection />
      <AvatarSection />
    </div>
  );
}

function InAppSection() {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(() => !new URLSearchParams(window.location.search).has("collapsed"));
  const [panel, setPanel] = useState<"update" | "goal">("update");
  const [goal, setGoal] = useState("Ship a clear, dependable workday experience.");
  const empty = new URLSearchParams(window.location.search).has("empty");
  const [history, setHistory] = useState<WorkOsConversationTurn[]>(() => empty ? [] : [
    { id: "preview-1", role: "user", text: "Finished the chat revamp draft and started verification.", createdAt: "2026-09-08T00:30:00Z" },
    { id: "preview-2", role: "assistant", text: "Nice — share what is left and I will turn it into records.", meta: "recorded", createdAt: "2026-09-08T00:31:00Z" },
  ]);
  const [pending, setPending] = useState("");
  const [receipt, setReceipt] = useState<{
    text: string;
    message: string;
    kind: "material_progress" | "completion_claim" | "blocked" | "priority_change" | "new_task";
  } | null>(null);
  return (
    <section aria-label="In-app composer preview" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 14 }}>In-app launcher</h2>
      {/* Stand-in for the page content that remains in normal flow while the
          viewport-anchored launcher waits in the lower corner. */}
      <div aria-hidden="true" style={{ height: 200 }} />
      <ProgressComposer
        displayName="David Zahemen"
        input={input}
        open={open}
        panel={panel}
        pending={pending}
        receipt={receipt}
        history={history}
        onClearChat={() => {
          setHistory([]);
          setPending("");
          setReceipt(null);
        }}
        busy={false}
        required={false}
        goal={goal}
        goalProvenance="employee"
        goalSuggestion={null}
        saveState="saved"
        onInput={setInput}
        onOpen={() => {
          setPanel("update");
          setOpen(true);
        }}
        onOpenGoal={() => setPanel("goal")}
        onClose={() => setOpen(false)}
        onSubmit={() => {
          const text = input.trim();
          if (!text) return;
          setHistory((current) => [...current, { id: `preview-${Date.now()}`, role: "user", text, createdAt: new Date().toISOString() }]);
          setPending(text);
          setReceipt(null);
          setInput("");
        }}
        onClassify={(kind) => {
          setReceipt({ text: pending, kind, message: `Recorded “${pending}” as ${kind.replaceAll("_", " ")} for today.` });
          setPending("");
        }}
        onGoal={setGoal}
        onAcceptSuggestion={() => undefined}
      />
    </section>
  );
}

const noop = () => undefined;

/** Dev-only fixture for the uncertain-create recovery: the server flags an
 * unresolved Nifty create and the result offers the clear-and-retry action. */
function CreateRecoverySection() {
  const [requested, setRequested] = useState<string | null>(null);
  const results: ToolCallResult[] = [
    {
      op: { op: "create_task", statement: "Add “Prepare companion handoff” to today.", taskTitle: "Prepare companion handoff", proposalId: "preview-create-unresolved", enabled: false },
      status: "failed",
      message: "A previous attempt may have created this task in Nifty but it is not listed yet. Retry to adopt it if it exists, or confirm nothing was created to clear the recorded attempt and file it once.",
      retryable: true,
      createResolution: "no_task_created",
    },
    {
      op: { op: "complete_task", statement: "Mark done: Repair provider sync", taskTitle: "Repair provider sync", proposalId: "preview-complete-retry", enabled: false },
      status: "failed",
      message: "Not filed. The server still shows this proposal as pending, so it is safe to retry.",
      retryable: true,
    },
  ];
  return (
    <section aria-label="Uncertain create recovery preview" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 14 }}>Uncertain Nifty create</h2>
      <ApprovalResults
        results={results}
        onRetry={(result) => setRequested(`${result.createResolution ? "Clear-and-retry" : "Retry"} requested for ${result.op.taskTitle ?? "update"}.`)}
      />
      {requested ? <p role="status" style={{ margin: 0, fontSize: 13 }}>{requested}</p> : null}
    </section>
  );
}

/** DEV-only review surface for the post-install announcement (design §19.8):
 * the success flyout plus the changelog modal it opens. */
function WhatsNewSection() {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState<string | null>(null);
  // The newest logged release stands in for the installed build, so the modal
  // previews real notes and the history's installed tag.
  const version = changelogHistory(CHANGELOG_RAW)[0]?.version ?? "0.0.0";
  const history = changelogHistory(CHANGELOG_RAW, version);
  const bullets = history[0]?.bullets ?? [];
  const copy = updateInstalledCopy(version);
  return (
    <section aria-label="Post-update announcement preview" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 14 }}>Post-update announcement</h2>
      <NotificationFlyouts
        notifications={[{
          id: "whatsnew",
          tone: "success",
          title: copy.title,
          message: copy.message,
          persistence: "persistent",
          persistenceKey: "preview-whatsnew",
          actions: [
            { label: copy.changelogLabel, kind: "primary", onClick: () => { setRequested(`Changelog opened for ${displayUpdateVersion(version)}.`); setOpen(true); } },
            { label: copy.dismissLabel, kind: "quiet", onClick: () => setRequested("Announcement dismissed.") },
          ],
        }]}
        onDismiss={() => undefined}
      />
      {open && <WhatsNewModal
        displayVersion={displayUpdateVersion(version)}
        bullets={bullets}
        history={history}
        onClose={() => setOpen(false)}
      />}
      {requested ? <p role="status" style={{ margin: 0, fontSize: 13 }}>{requested}</p> : null}
    </section>
  );
}

function InAppToolsSection() {
  const operations = [
    { op: "complete_task" as const, statement: "Employee confirmed completion of Repair provider sync.", taskId: "t-overdue", taskTitle: "Repair provider sync", proposalId: "p-1", enabled: true },
    { op: "complete_task" as const, statement: "Employee confirmed completion of Ship the avatar review flow.", taskId: "t-today", taskTitle: "Ship the avatar review flow", proposalId: "p-2", enabled: true },
    { op: "display_pending_tasks" as const, statement: "Show pending.", limit: 5, enabled: false },
  ];
  const composer = {
    input: "", open: true, panel: "update" as const, receipt: null, history: [], busy: false,
    required: false, goal: "", goalProvenance: null, goalSuggestion: null, saveState: "saved" as const,
    onInput: noop, onOpen: noop, onOpenGoal: noop, onClose: noop, onSubmit: noop,
    onClassify: noop, onGoal: noop, onAcceptSuggestion: noop,
  };
  return (
    <section aria-label="In-app tool surfaces preview" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 14 }}>In-app thinking trace</h2>
      <ProgressComposer
        {...composer}
        pending="Show my pending tasks and finish the sync repair"
        interpretation={{ status: "loading", operations: [], taskOptions: [] }}
        thinking={{ stages: [{ label: "Sending your update" }, { label: "Filing proposals" }], active: 1, startedAt: Date.now() - 2400 }}
      />
      <h2 style={{ margin: 0, fontSize: 14 }}>In-app tool cards</h2>
      <ProgressComposer
        {...composer}
        pending="Review the selected task completions before anything changes."
        interpretation={{
          status: "ready",
          operations,
          taskOptions: [],
          reply: "Review the selected task completions before anything changes.",
          results: [{
            op: operations[2]!, status: "recorded", message: "Pending tasks loaded.",
            data: { provider_result: { view: "pending", tasks: [
              { id: "t-9", title: "Document release evidence", description: "Capture the screenshots and validation states.", due_date: null, project_name: "Work OS", state: "pending" },
              { id: "t-10", title: "Repair provider sync", description: "Verify the Nifty readback before release.", due_date: "2026-09-06", project_name: "Platform", state: "overdue" },
              { id: "t-11", title: "Prepare companion handoff", due_date: "2026-09-11", project_name: "Desktop", state: "pending" },
            ] } },
          }],
        }}
        toolContext={{ shiftDate: "2026-09-07", personId: null, promptKind: "optional" }}
      />
      <h2 style={{ margin: 0, fontSize: 14 }}>In-app filing outcomes</h2>
      <ProgressComposer
        {...composer}
        pending="File these two completions"
        interpretation={{
          status: "ready",
          operations: [
            { op: "complete_task" as const, statement: "Employee confirmed completion of Repair provider sync.", taskId: "t-overdue", taskTitle: "Repair provider sync", enabled: false, failure: "That task is no longer in your task list. Refresh and try again." },
            { op: "complete_task" as const, statement: "Employee confirmed completion of Ship the avatar review flow.", taskId: "t-today", taskTitle: "Ship the avatar review flow", enabled: false, failure: "That task is not assigned to you." },
          ],
          taskOptions: [],
          reply: "I could not file either completion.",
        }}
      />
      <ProgressComposer
        {...composer}
        pending="File the completions I selected"
        interpretation={{
          status: "ready",
          operations: [
            { op: "complete_task" as const, statement: "Employee confirmed completion of Repair provider sync.", taskId: "t-overdue", taskTitle: "Repair provider sync", proposalId: "p-partial", enabled: true },
            { op: "complete_task" as const, statement: "Employee confirmed completion of Document release evidence.", taskId: "t-11", taskTitle: "Document release evidence", enabled: false, failure: "That task is no longer in your task list. Refresh and try again." },
          ],
          taskOptions: [],
          reply: "One completion is ready for review; the other task left your list.",
        }}
      />
    </section>
  );
}

const AVATAR_TASKS = [
  {
    id: "t-overdue",
    title: "Repair provider sync",
    dueDate: "2026-09-06",
    state: "overdue" as const,
    subtaskTotal: 3,
    subtaskCompleted: 1,
    subtasks: [
      { id: "t-overdue-1", title: "Reproduce the stale mirror", completed: true },
      { id: "t-overdue-2", title: "Patch the provider refresh", completed: false },
      { id: "t-overdue-3", title: "Verify with a second device", completed: false },
    ],
  },
  { id: "t-today", title: "Ship the avatar review flow", dueDate: "2026-09-07", state: "pending" as const },
  { id: "t-open", title: "Document release evidence", dueDate: null, state: "pending" as const },
];

function AvatarSection({ standalone = false }: { standalone?: boolean }) {
  const [tab, setTab] = useState<"chat" | "tasks">("chat");
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<Array<{ id: string; text: string }>>([]);
  const empty = new URLSearchParams(window.location.search).has("empty");
  return (
    <section aria-label="Avatar panel preview" style={{ display: "grid", gap: standalone ? 0 : 12, width: standalone ? "100%" : undefined, height: standalone ? "100%" : undefined }}>
      {!standalone && <h2 style={{ margin: 0, fontSize: 14 }}>Floating companion panel</h2>}
      <ConversationSurface surface="floating" ariaLabel={`${MASCOT.name} companion preview`} className="avatar-panel" style={{ width: "min(400px, 100%)", height: 620 }}>
        <header className="avatar-head">
          <div className="avatar-head-row">
            <div className="avatar-drag-zone">
              <div className="avatar-title">
                <span className="avatar-head-mark avatar-otto-mark" aria-hidden="true"><MascotMark pose="focus" /></span>
                <div className="avatar-head-copy">
                  <strong title="On shift · September 7">
                    <span className="avatar-head-shift">On shift · 2h 14m</span>
                  </strong>
                </div>
              </div>
            </div>
            <div className="avatar-nav">
              <ChatTabs
                tabs={[
                  { id: "chat", label: "Chat" },
                  { id: "tasks", label: "Tasks", count: AVATAR_TASKS.length },
                ]}
                active={tab}
                onSelect={(id) => setTab(id as "chat" | "tasks")}
                ariaLabel="Companion view"
              />
            </div>
            <div className="avatar-head-actions">
              <button className="avatar-icon" aria-label="New conversation" title="New conversation">
                <SquarePen size={15} aria-hidden="true" />
              </button>
              <button className="avatar-icon" aria-label="Collapse companion" title="Collapse companion">
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>
         <div className="conversation-scroll-region">
         {tab === "tasks" ? (
           <div className="avatar-chat">
            <TaskSelectionCard
              title="Open tasks"
              tasks={AVATAR_TASKS}
              onMarkSelectedDone={() => undefined}
              emptyTitle="No open tasks"
              emptyMessage="Tasks waiting to be completed will appear here."
            />
          </div>
        ) : (
          <div className="avatar-chat workos-thread">
            {empty ? <ChatWelcome displayName="David Zahemen" seed="floating:2026-09-07" /> : <>
              <section className="avatar-context check_in" aria-label="Check-in due">
                <strong>Check-in due</strong>
                <small>Your last recorded update was at 3:06 PM. What's changed since then?</small>
              </section>
              <ChatTurn role="assistant" text="Share an update, or tell me to create, complete, or block tasks." />
              <ChatTurn role="user" text="Show my pending tasks" />
              <ChatTurn role="assistant" text="Here are your open tasks. Viewing never needs approval.">
                  <TaskSelectionCard
                    title="Pending tasks"
                    tasks={AVATAR_TASKS}
                    onMarkSelectedDone={() => undefined}
                    maxHeight={250}
                    emptyTitle="No pending tasks"
                    emptyMessage="Tasks waiting to be completed will appear here."
                  />
                  <div className="chat-operations">
                    <ApprovalFlow
                      operations={[
                        { op: "complete_task", statement: "Finished the sync repair.", taskId: "t-overdue", taskTitle: "Repair provider sync", proposalId: "preview-approval-1", enabled: true },
                        { op: "record_progress", statement: "Documented release evidence.", taskId: "t-open", taskTitle: "Document release evidence", proposalId: "preview-approval-2", enabled: true },
                      ]}
                      context={{ shiftDate: "2026-09-07", personId: null, promptKind: "optional" }}
                      onSubmit={() => undefined}
                    />
                    <NavigateButton page="review" statement="Your EOD draft is due at 8 PM." onNavigate={() => undefined} />
                  </div>
              </ChatTurn>
              {entries.map((entry) => (
                <ChatTurn key={entry.id} role="user" text={entry.text} />
              ))}
            </>}
          </div>
         )}
         </div>
         <footer className="avatar-composer-v2 px-2.5 pb-2.5 pt-2">
          <WorkOsPromptBar
            value={input}
            onChange={setInput}
            onSend={() => {
              const text = input.trim();
              if (!text) return;
              setEntries((current) => [...current, { id: `preview-${current.length}`, text }]);
              setInput("");
            }}
            placeholder="Share an update or instruct the assistant…"
            ariaLabel="Share an update or instruct the assistant"
            canSend={!!input.trim()}
            commands={workOsChatCommands({ eod: () => undefined }).map((command) =>
              command.key === "focus" ? { ...command, insert: "Focus: " } : command,
            )}
            sendLabel="Send update"
          />
        </footer>
      </ConversationSurface>
    </section>
  );
}

/** DEV-only: the grouped batch card in all three states — awaiting a decision,
 * after a partial failure, and after every item filed. Used for the visual and
 * interaction review of the multi-task tools (design §25.10.2). */
function BatchSection() {
  const [liveResult, setLiveResult] = useState<ToolCallResult | undefined>();
  const [liveMessage, setLiveMessage] = useState("");
  const context = { shiftDate: "2026-09-18", personId: "person-1", promptKind: "optional" };
  const addBatch = {
    op: "multi_task_add" as const,
    statement: "Add the launch checklist.",
    enabled: true,
    batchId: "batch-preview-add",
    tasks: [
      {
        clientId: "t1",
        title: "Draft the launch plan",
        description: "Cover scope, owners, and the rollout order.",
        subtasks: [
          { clientId: "s1", title: "Collect inputs from each team" },
          { clientId: "s2", title: "Circulate the draft for review", description: "Two working days ahead." },
        ],
      },
      { clientId: "t2", taskId: "t-1", displayTitle: "Ship the debug window fixture", subtasks: [{ clientId: "s3", title: "Verify the debug window fixture" }] },
    ],
  };
  const editBatch = {
    op: "multi_task_edit" as const,
    statement: "Move the release work on.",
    enabled: true,
    batchId: "batch-preview-edit",
    tasks: [
      { clientId: "t1", taskId: "t-1", title: "Ship the debugger fix (final)", taskGroupId: "col-done", fromStatus: "In review", toStatus: "Done", subtasks: [] },
      { clientId: "t2", taskId: "t-2", completed: true, subtasks: [] },
      { clientId: "t3", taskId: "t-3", title: "Package the Windows installer", subtasks: [] },
    ],
  };
  const partial = {
    op: addBatch,
    status: "failed" as const,
    message: "3 of 4 changes were filed. 1 still needs attention.",
    retryable: true,
    data: {
      batch: {
        results: [
          { proposal_id: "p1", client_id: "t1", parent_client_id: null, operation: "create_task", status: "applied", outcome: "applied", message: "Recorded." },
          { proposal_id: "p2", client_id: "s1", parent_client_id: "t1", operation: "add_subtask", status: "applied", outcome: "applied", message: "Recorded." },
          { proposal_id: "p3", client_id: "s2", parent_client_id: "t1", operation: "add_subtask", status: "applied", outcome: "applied", message: "Recorded." },
          { proposal_id: "p4", client_id: "s3", parent_client_id: "t-1", operation: "add_subtask", status: "failed", outcome: "failed", message: "The task changed after this proposal was drafted. Create a new proposal from the current task state." },
        ],
      },
    },
  };
  const archiveBatch = {
    op: "multi_task_archive" as const,
    statement: "Archive the finished release work.",
    enabled: true,
    batchId: "batch-preview-archive",
    tasks: [
      { clientId: "t1", taskId: "t-1", subtasks: [] },
      { clientId: "t2", taskId: "t-2", subtasks: [] },
    ],
  };
  const logBatch = {
    op: "multi_task_log" as const,
    statement: "Note progress on two tasks.",
    enabled: true,
    batchId: "batch-preview-log",
    tasks: [
      { clientId: "t1", taskId: "t-1", description: "Shipped the batch schema and the grouped card.", subtasks: [] },
      { clientId: "t2", taskId: "t-2", description: "Paired on the review and closed the feedback.", subtasks: [] },
    ],
  };
  const importBatch = {
    op: "plan_import" as const,
    statement: "Import the SEO onboarding plan for Acme.",
    enabled: true,
    batchId: "batch-preview-import",
    planImport: { blueprintId: "bp-1", clientName: "Acme", startDate: "2026-09-22" },
  };
  const skipped = {
    op: addBatch,
    status: "denied" as const,
    message: "Skipped. Nothing from this batch was recorded.",
    data: {
      batch: {
        results: [
          { proposal_id: "r1", client_id: "t1", parent_client_id: null, operation: "create_task", status: "rejected", outcome: "rejected", message: "Rejected." },
          { proposal_id: "r2", client_id: "s1", parent_client_id: "t1", operation: "add_subtask", status: "skipped", outcome: null, message: "Its task was not created, so this step was left alone." },
        ],
      },
    },
  };
  const settlePreview = (operation: ProposedOperation, status: "recorded" | "denied") => {
    const skippedParent = status === "denied";
    const items = (operation.tasks ?? []).flatMap((task) => [
      ...(operation.op === "multi_task_add" && task.taskId ? [] : [{
        proposal_id: `${task.clientId}-proposal`,
        client_id: task.clientId,
        parent_client_id: null,
        operation: operation.op === "multi_task_add" ? "create_task" : "update_task",
        status: skippedParent ? "rejected" : "applied",
        outcome: skippedParent ? "rejected" : "applied",
        message: skippedParent ? "Rejected." : "Recorded.",
      }]),
      ...task.subtasks.map((subtask) => ({
        proposal_id: `${subtask.clientId}-proposal`,
        client_id: subtask.clientId,
        parent_client_id: task.clientId,
        operation: "add_subtask",
        status: skippedParent ? "skipped" : "applied",
        outcome: skippedParent ? null : "applied",
        message: skippedParent ? "Its task was not created, so this step was left alone." : "Recorded.",
      })),
    ]);
    setLiveResult({
      op: operation,
      status,
      message: skippedParent ? "Skipped. Nothing from this batch was recorded." : `Filed ${items.length} changes.`,
      data: { batch: { results: items } },
    });
    setLiveMessage(skippedParent ? "The batch was skipped." : "The batch was filed and is now a receipt.");
  };
  const filed = {
    op: editBatch,
    status: "recorded" as const,
    message: "Filed 3 changes.",
    data: {
      batch: {
        results: [
          { proposal_id: "q1", client_id: "t1", parent_client_id: null, operation: "update_task", status: "applied", outcome: "applied", message: "Recorded." },
          { proposal_id: "q2", client_id: "t2", parent_client_id: null, operation: "complete_task", status: "applied", outcome: "applied", message: "Recorded." },
          { proposal_id: "q3", client_id: "t3", parent_client_id: null, operation: "update_task", status: "applied", outcome: "applied", message: "Recorded." },
        ],
      },
    },
  };
  return <>
    <section aria-label="Interactive batch card"><strong style={{ fontSize: 12 }}>Interactive batch card</strong>
      <TaskBatchCard operation={addBatch} result={liveResult} context={context} onApprove={(operation) => settlePreview(operation, "recorded")} onSkip={(operation) => settlePreview(operation, "denied")} onRetry={() => undefined} />
      {liveMessage ? <p role="status" style={{ margin: 0, fontSize: 12 }}>{liveMessage}</p> : null}
    </section>
    <section><strong style={{ fontSize: 12 }}>Awaiting a decision</strong>
      <TaskBatchCard operation={addBatch} context={context} onApprove={() => undefined} onSkip={() => undefined} onRetry={() => undefined} />
    </section>
    <section><strong style={{ fontSize: 12 }}>Edits, after a partial failure</strong>
      <TaskBatchCard operation={addBatch} result={partial} context={context} onApprove={() => undefined} onSkip={() => undefined} onRetry={() => undefined} />
    </section>
    <section><strong style={{ fontSize: 12 }}>An edit batch</strong>
      <TaskBatchCard operation={editBatch} context={context} onApprove={() => undefined} onSkip={() => undefined} onRetry={() => undefined} />
    </section>
    <section><strong style={{ fontSize: 12 }}>Filed</strong>
      <TaskBatchCard operation={editBatch} result={filed} context={context} onApprove={() => undefined} onSkip={() => undefined} onRetry={() => undefined} />
    </section>
    <section><strong style={{ fontSize: 12 }}>Archiving (danger tone)</strong>
      <TaskBatchCard operation={archiveBatch} context={context} onApprove={() => undefined} onSkip={() => undefined} onRetry={() => undefined} />
    </section>
    <section><strong style={{ fontSize: 12 }}>Progress notes</strong>
      <TaskBatchCard operation={logBatch} context={context} onApprove={() => undefined} onSkip={() => undefined} onRetry={() => undefined} />
    </section>
    <section><strong style={{ fontSize: 12 }}>Plan import</strong>
      <TaskBatchCard operation={importBatch} context={context} onApprove={() => undefined} onSkip={() => undefined} onRetry={() => undefined} />
    </section>
    <section><strong style={{ fontSize: 12 }}>Skipped</strong>
      <TaskBatchCard operation={addBatch} result={skipped} context={context} onApprove={() => undefined} onSkip={() => undefined} onRetry={() => undefined} />
    </section>
  </>;
}
