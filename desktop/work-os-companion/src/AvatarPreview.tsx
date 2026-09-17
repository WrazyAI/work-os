import { useState } from "react";
import { AvatarThinking } from "./AvatarThinking";
import { AgendaReviewCard } from "./AgendaReviewCard";
import { ApprovalResults } from "./ApprovalFlow";
import { NavigateButton } from "./NavigateButton";
import { TaskSelectionCard } from "./TaskSelectionCard";
import { deriveTaskContext } from "./avatarTaskContext";
import type { AgendaAnswers } from "./avatarAgenda";
import type { ToolCallResult } from "./interpretation";

/** DEV-only visual review surface for the floating avatar's new patterns:
 * thinking trace (working + settled), agenda follow-ups, and the
 * pending/overdue task card. Never shipped; see main.tsx preview routes. */
export default function AvatarPreview() {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get("scenario") ?? "all";
  const [answers, setAnswers] = useState<AgendaAnswers>({ q1: "The avatar check-in flow" });
  const show = (name: string) => scenario === "all" || scenario === name;

  const context = deriveTaskContext(
    [
      {
        id: "t-overdue",
        title: "Repair provider sync",
        dueDate: "2026-09-06",
        completed: false,
        subtaskTotal: 3,
        subtaskCompleted: 1,
        subtasks: [
          { id: "t-overdue-1", title: "Reproduce the stale mirror", completed: true },
          { id: "t-overdue-2", title: "Patch the provider refresh", completed: false },
          { id: "t-overdue-3", title: "Verify with a second device", completed: false },
        ],
      },
      { id: "t-today", title: "Ship the avatar review flow", dueDate: "2026-09-07", completed: false },
      { id: "t-open", title: "Document release evidence", dueDate: null, completed: false },
      { id: "t-done", title: "Remove Plan navigation", dueDate: "2026-09-06", completed: true },
    ],
    "2026-09-07",
  );
  const filingResults: ToolCallResult[] = [
    {
      op: { op: "create_task", statement: "Integrate CodeRabbit into Work OS", taskTitle: "Integrate CodeRabbit into Work OS", enabled: false },
      status: "recorded",
      message: "Recorded after a slow response. The server confirmed the change applied.",
    },
    {
      op: { op: "complete_task", statement: "Mark done: Fix desktop history persistence", taskTitle: "Fix desktop history persistence", enabled: false },
      status: "processing",
      message: "The server is still processing this change. Do not retry — recheck Review in a moment.",
    },
    {
      op: { op: "complete_task", statement: "Mark done: Work Memory P3", taskTitle: "Work Memory P3", proposalId: "preview-proposal-unfiled", enabled: false },
      status: "failed",
      message: "Not filed. The server still shows this proposal as pending, so it is safe to retry.",
      retryable: true,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 420, padding: 24 }}>
      {show("thinking") && (
        <section aria-label="Thinking trace preview">
          <AvatarThinking
            stages={[{ label: "Reading today's context" }, { label: "Matching your tasks", detail: "3 open" }, { label: "Drafting proposals" }]}
            active={1}
            startedAt={Date.now() - 1800}
            activeLabel="Reviewing your agenda"
          />
          <div style={{ height: 12 }} />
          <AvatarThinking
            stages={[{ label: "Reading today's context" }, { label: "Matching your tasks" }, { label: "Drafting proposals" }]}
            active={-1}
            startedAt={0}
            settledMs={2400}
            result="2 proposals to review"
          />
        </section>
      )}
      {show("agenda") && (
        <section aria-label="Agenda review preview">
          <AgendaReviewCard
            clarifications={[
              { id: "q1", question: "What part of WorkOS are you working on?" },
              { id: "q2", question: "What does done look like today?" },
            ]}
            answers={answers}
            onAnswers={setAnswers}
            onSend={() => undefined}
            onSkip={() => undefined}
            onCancel={() => undefined}
            busy={false}
          />
        </section>
      )}
      {show("tasks") && (
        <section aria-label="Task context preview">
          <TaskSelectionCard
            dense
            maxHeight={240}
            title="Today's tasks"
            tasks={context.visible.map((task) => ({
              id: task.id,
              title: task.title,
              dueDate: task.dueDate,
              state: task.overdue ? "overdue" : "pending",
              subtaskTotal: task.subtaskTotal,
              subtaskCompleted: task.subtaskCompleted,
              subtasks: task.subtasks,
            }))}
            onMarkSelectedDone={() => undefined}
            proposedTaskIds={["t-done"]}
            onReview={() => undefined}
            emptyTitle="No open tasks"
            emptyMessage="Tasks waiting to be completed will appear here."
          />
          <div style={{ height: 16 }} />
          <TaskSelectionCard
            dense
            title="Pending tasks"
            collapseWhenInactive
            tasks={context.visible.filter((task) => !task.overdue).map((task) => ({
              id: task.id, title: task.title, dueDate: task.dueDate, state: "pending" as const,
            }))}
            onMarkSelectedDone={() => undefined}
            emptyTitle="No pending tasks"
            emptyMessage="Tasks waiting to be completed will appear here."
          />
        </section>
      )}
      {show("approvals") && (
        <section aria-label="Approval results preview">
          <ApprovalResults results={filingResults} onRetry={() => undefined} />
          <div style={{ height: 12 }} />
          <NavigateButton page="review" statement="Your EOD report is due." onNavigate={() => undefined} />
        </section>
      )}
    </div>
  );
}
