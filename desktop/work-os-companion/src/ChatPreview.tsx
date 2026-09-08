import { useState } from "react";
import { ProgressComposer } from "./App";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatTabs, WorkOsPromptBar, workOsChatCommands } from "./WorkOsChat";
import { NavigateButton } from "./NavigateButton";
import { ToolApprovalCard } from "./ToolApprovalCard";
import { TaskSelectionCard } from "./TaskSelectionCard";
import type { WorkOsConversationTurn } from "./vault";

/** DEV-only visual review surface for the shared chat language
 * (design §25.11): the real in-app ProgressComposer plus a faithful
 * avatar-panel replica built from the same ChatTabs/WorkOsPromptBar
 * primitives. Never shipped; see main.tsx preview routes. */
export default function ChatPreview() {
  const params = new URLSearchParams(window.location.search);
  const isolate = params.get("isolate");
  if (isolate === "avatar") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 860, padding: 24 }}>
        <AvatarSection />
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
  const [panel, setPanel] = useState<"update" | "goal">("update");
  const [goal, setGoal] = useState("Ship a clear, dependable workday experience.");
  const [history, setHistory] = useState<WorkOsConversationTurn[]>([
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
      <h2 style={{ margin: 0, fontSize: 14 }}>In-app dock</h2>
      {/* Stand-in for the page content the sticky dock intentionally
          pulls up over (margin-top: -82px), as on Today/Tasks. */}
      <div aria-hidden="true" style={{ height: 200 }} />
      <ProgressComposer
        input={input}
        open
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
        onOpen={() => setPanel("update")}
        onOpenGoal={() => setPanel("goal")}
        onClose={() => undefined}
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
            data: { provider_result: { view: "pending", tasks: [{ id: "t-9", title: "Document release evidence", due_date: null }] } },
          }],
        }}
        toolContext={{ shiftDate: "2026-09-07", personId: null, promptKind: "optional" }}
      />
    </section>
  );
}

const AVATAR_TASKS = [
  { id: "t-overdue", title: "Repair provider sync", dueDate: "2026-09-06", state: "overdue" },
  { id: "t-today", title: "Ship the avatar review flow", dueDate: "2026-09-07", state: "pending" },
  { id: "t-open", title: "Document release evidence", dueDate: null, state: "pending" },
];

function AvatarSection() {
  const [tab, setTab] = useState<"chat" | "tasks">("chat");
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<Array<{ id: string; text: string }>>([]);
  return (
    <section aria-label="Avatar panel preview" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 14 }}>Floating companion panel</h2>
      <div className="avatar-panel" style={{ width: "min(400px, 100%)", height: 560 }}>
        <header className="avatar-head">
          <div className="avatar-drag-zone">
            <div className="avatar-title">
              <span className="avatar-head-mark" aria-hidden="true">
                WO
              </span>
              <div>
                <strong>On shift · 2h 14m</strong>
                <small>Next update 3:05 PM</small>
              </div>
            </div>
          </div>
          <button className="avatar-close" aria-label="Collapse companion">
            ×
          </button>
        </header>
        <div className="avatar-tabs">
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
            <div className="chat-entry assistant">
              <ChatMarkdown text="Share an update, or tell me to create, complete, or block tasks." />
            </div>
            <div className="chat-entry user">
              <ChatMarkdown text="Show my pending tasks" />
            </div>
            <div className="chat-entry assistant">
              <ChatMarkdown text="Here are your open tasks — viewing never needs approval." />
              <TaskSelectionCard
                title="Pending tasks"
                tasks={AVATAR_TASKS}
                onMarkSelectedDone={() => undefined}
                maxHeight={250}
                emptyTitle="No pending tasks"
                emptyMessage="Tasks waiting to be completed will appear here."
              />
              <div className="chat-operations">
                <ToolApprovalCard
                  op={{ op: "complete_task", statement: "Finished the sync repair.", taskId: "t-overdue", taskTitle: "Repair provider sync", enabled: true }}
                  context={{ shiftDate: "2026-09-07", personId: null, promptKind: "optional" }}
                  index={0}
                  total={2}
                />
                <NavigateButton page="review" statement="Your EOD draft is due at 8 PM." onNavigate={() => undefined} />
              </div>
            </div>
            {entries.map((entry) => (
              <div key={entry.id} className="chat-entry user">
                <ChatMarkdown text={entry.text} />
              </div>
            ))}
          </div>
        )}
        <footer className="avatar-composer">
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
      </div>
    </section>
  );
}
