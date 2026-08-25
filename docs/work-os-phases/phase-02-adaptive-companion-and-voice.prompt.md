# Phase 2 Product Plan — Task-Led Standups, Role-Aware Check-ins, and EOD Review

## Status and authorization boundary

This document defines the proposed Phase 2 product direction for Work OS. It is a planning specification, not authorization to implement, migrate data, call paid model APIs, connect providers, deploy, or alter production configuration.

Phase 1 remains under final acceptance. Phase 2 planning may continue, but implementation must not begin until the Phase 1 prerequisite contract below has been reconciled with the accepted Phase 1 behavior.

## Product thesis

Work OS should organize a workday around one traceable loop:

```text
authoritative tasks establish intent
  -> role-aware check-ins capture progress, blockers, and changed priorities
  -> EOD Review reconciles planned work with actual outcomes and known evidence
```

The product must reduce duplicate reporting rather than ask an employee to maintain a goal, task list, hourly narrative, and EOD report as separate sources of truth.

Nifty remains authoritative for task state. A daily focus is a generated, revisable summary of the employee's accepted tasks and original daily statement. It is not a second independently confirmed plan.

## Phase 1 prerequisite contract

Phase 2 assumes Phase 1 has been accepted with:

- One recoverable work session per employee and local work date.
- Explicit employee clock-in and clock-out behavior.
- A unified Tasks experience for today, history, carry-over, and subtasks.
- Nifty-backed task creation, editing, completion, reopening, and archival with provider readback.
- An auditable daily-workspace history shared by Dashboard, Tasks, Insights, and EOD.
- Typed offline mutation handling with visible permanent failures.
- Role, responsibility, team, manager, schedule, privacy, and provider mappings.
- Activity treated as observational context, never proof of attendance, productivity, or task completion.

Any prerequisite that remains unaccepted is a Phase 1 blocker. It must not be silently reimplemented under Phase 2.

## Non-negotiable product rules

1. **Tasks establish work intent.** The system may summarize tasks as a daily focus, but it must not require a redundant goal confirmation.
2. **AI proposes; people decide.** Model output never silently mutates Nifty, responsibilities, schedules, check-in policy, or reports.
3. **Evidence and absence are distinct.** Missing provider evidence, silence, stale data, and provider failure must never be reported as zero work or employee misconduct.
4. **No productivity or slacking score.** Phase 2 identifies unresolved commitments, missing updates, blockers, and discrepancies. It does not infer motivation or employee intent.
5. **Every material claim is traceable.** Generated summaries and questions reference the tasks, check-ins, responsibilities, or provider events that caused them.
6. **Provider failures remain visible.** Work OS does not silently replace authoritative provider data with model inference.
7. **The non-AI workday remains usable.** Tasks, deterministic check-ins, and deterministic EOD reconciliation continue when the model provider is unavailable.

## Scope

### In scope

- A single daily-intent interaction at clock-in.
- AI-assisted daily focus inference and reviewable task proposals.
- Role and editable responsibility configuration.
- Project Manager and free-text custom roles.
- Scheduled, role-aware check-ins during an active work session.
- Employee text responses and structured interpretation.
- Deterministic planned-versus-actual EOD reconciliation.
- AI-assisted EOD Review narrative grounded in the reconciliation record.
- Server-side OpenRouter orchestration using `openai/gpt-5.6-luna` with evaluated reasoning settings.
- Prompt/model versioning, structured-output validation, auditability, cost and latency telemetry, and deterministic fallback behavior.
- An initial Engineer and Project Manager pilot.

### Deferred until separately approved

- Voice recording and transcription.
- Floating avatars, pets, and animation systems.
- Automatic task/provider writes without employee review.
- Automated performance ratings, rankings, disciplinary alerts, or productivity scores.
- Screenshot-derived productivity conclusions.
- Sales rollout before call, email, appointment, and CRM evidence sources are explicitly selected and validated.
- Company-wide rollout before the initial role pilots pass their acceptance gates.

## Workstream 1 — Role and responsibility intelligence

On first use, an employee selects a role from a configurable catalog. The initial catalog must include at least:

- Engineer
- Product
- Design
- Marketing
- Sales
- Project Manager
- Something else

“Something else” requires a human-readable role name. Role labels are not sufficient context by themselves; the employee must review suggested responsibilities and may add custom responsibilities.

Each responsibility should be a versioned, editable record with:

```ts
type ResponsibilityDefinition = {
  id: string;
  label: string;
  description: string;
  roleIds: string[];
  expectedSignals: string[];
  evidenceProviderKinds: string[];
  checkInDimensions: string[];
  eodDimensions: string[];
  provenance: "catalog" | "organization" | "employee";
  enabled: boolean;
  version: number;
};
```

Responsibilities determine which questions are relevant; they do not establish quotas or prove that an outcome occurred. Organization defaults and employee customizations must remain distinguishable in the audit trail.

## Workstream 2 — One daily-intent interaction

At clock-in, Work OS loads the employee's resolved daily workspace before asking:

> What are you working on today?

The model receives only the minimum relevant context:

- The employee's original statement.
- Today's accepted Nifty tasks and subtasks.
- Explicit carry-over and overdue candidates.
- Role and enabled responsibilities.
- Known schedule boundary.
- Provider freshness and availability, without treating activity as outcomes.

The response must validate against a structured proposal:

```ts
type DailyIntentProposal = {
  focusSummary: string;
  taskActions: Array<
    | { type: "create"; title: string; description?: string; parentTaskId?: string }
    | { type: "prioritize"; taskId: string; priority: number }
    | { type: "carry"; taskId: string; reason: string }
    | { type: "defer"; taskId: string; reason: string }
  >;
  clarifyingQuestions: string[];
  sourceReferences: string[];
};
```

The employee may edit, accept, or reject every proposed action. Accepted provider operations are idempotent, audited, and verified by Nifty readback. The displayed daily focus is then derived from the accepted workspace while preserving the original employee statement separately.

If AI is unavailable, the employee can still select, order, create, and carry tasks manually. The UI must label the focus as manually organized rather than AI inferred.

## Workstream 3 — Role-aware check-in engine

The initial organization policy may require an hourly check-in, but the scheduler must model explicit states rather than use a blind desktop timer:

```text
not_due
due
answered
snoozed
skipped_with_reason
missed
suppressed_on_break
suppressed_after_clock_out
provider_unavailable
```

The server calculates the next eligible check-in from:

- Explicit clock-in and shift boundary.
- Break and clock-out state.
- Organization cadence policy.
- Last successful response or snooze.
- Material task changes since the prior response.
- Enabled responsibilities.
- Final-shift EOD transition.

Each prompt should ask one to three concrete questions. Examples:

- Engineer: completed tasks, resolved defects, remaining work, and blockers.
- Project Manager: milestone movement, dependencies, decisions, stakeholder follow-ups, and risks needing escalation.
- Sales, after evidence-provider approval: calls, replies, appointments, and pipeline movement.

Check-in output must separate employee statements from provider observations:

```ts
type CheckInResult = {
  employeeStatement: string;
  progress: Array<{ statement: string; taskId?: string }>;
  blockers: Array<{ statement: string; taskId?: string }>;
  changedPriorities: Array<{ statement: string; taskId?: string }>;
  proposedTaskActions: DailyIntentProposal["taskActions"];
  evidenceReferences: string[];
  unknowns: string[];
};
```

A missed check-in means only that no response was recorded. AI must not translate it into inactivity, low productivity, or slacking. Any manager notification policy for repeated missed check-ins requires separate organizational approval and must state exactly what was and was not observed.

## Workstream 4 — EOD Review and task reconciliation

“EOD Review” is the employee-facing term. It reconciles the accepted morning workspace, tasks added during the day, check-in statements, current Nifty state, and explicitly enabled provider evidence.

The deterministic reconciliation layer runs before narrative generation. Each commitment receives one of:

```text
completed
progressed
deferred
carried
blocked
added_during_day
not_evidenced
unknown
```

Archived tasks are excluded from commitment denominators. Deferred items are described but not counted as completed commitments. Provider absence or stale data yields `unknown` or `not_evidenced`, never zero activity.

Role-specific reconciliation is valid only when its evidence source is known:

- Planned calls versus provider-observed calls, or explicitly labeled self-reported calls.
- Planned emails versus provider-observed sent mail, or explicitly labeled self-report.
- Planned development tasks versus Nifty state and linked output evidence.
- Planned milestones versus task movement, decisions, and recorded dependencies.

The model converts the structured reconciliation into concise prose. Every material sentence carries claim-level references. If references cannot be attached reliably, Work OS uses deterministic prose instead.

The employee reviews and edits the EOD Review before submission. Phase 4 may add stronger manager review, governance, retention, and rollout hardening, but it must build on this employee reconciliation record rather than create a second EOD system.

## Workstream 5 — AI orchestration and governance

### Provider boundary

OpenRouter is the proposed server-side model gateway. `OPENROUTER_API_KEY` remains server-only and must never enter desktop bundles, browser responses, telemetry payloads, or general logs.

The initial configured model is:

```text
openai/gpt-5.6-luna
```

The requested initial reasoning effort is `high` for ambiguous planning and EOD synthesis. Reasoning effort is a per-operation evaluated setting, not a global product constant:

| Operation | Initial effort | Reason |
|---|---:|---|
| Daily focus and task decomposition | high | Ambiguous intent and provider context |
| Sensitive or conflicting EOD reconciliation | high | Requires careful abstention and references |
| Routine check-in question generation | medium | Bounded context and latency-sensitive |
| Check-in response structuring | low or medium | Schema extraction should not require maximum reasoning |
| Deterministic fallback | none | No model call |

Changing an effort level or model requires evaluation evidence. `openai/gpt-5.6-luna-pro` is a separate model and must not be substituted merely because Luna is configured with high reasoning.

### Typed orchestration

Business logic must call a provider-neutral, typed orchestration boundary rather than OpenRouter directly. Reuse the existing Agent OS job/run infrastructure for asynchronous execution and observability; do not create a second agent queue.

Every AI run records:

- Organization, person, work date, and operation kind.
- Provider, model, reasoning effort, and route policy.
- Prompt, schema, and responsibility-set versions.
- Source-reference IDs, never unbounded raw provider payloads.
- Request ID, latency, token usage, and estimated cost.
- Structured-output validation result.
- Tool requests and human-approved operations.
- Acceptance, edit, rejection, abstention, and fallback outcomes.

### Tool and MCP policy

MCP or API access is a transport mechanism, not permission to mutate data. Tools are allowlisted per operation and scoped to the employee's organization and identity. Read tools may assemble context. Write tools produce proposals unless a separately approved contract explicitly allows another behavior.

Provider writes require:

1. A validated structured proposal.
2. An employee decision.
3. An idempotency key.
4. Provider execution.
5. Provider readback.
6. A visible success or retryable/permanent failure state.

### Failure behavior

If OpenRouter is unavailable, rate-limited, over budget, or returns invalid structured output:

- Daily tasks remain available.
- Daily organization remains manually usable.
- Check-ins use deterministic role/responsibility templates.
- EOD Review uses deterministic reconciliation prose.
- No model-derived provider write is attempted.
- The UI visibly identifies AI assistance as unavailable or degraded.

There is no silent fallback to an unapproved model. A fallback model requires an explicit route policy and must be recorded in the run.

## Evaluation plan before implementation

Create a sealed evaluation set covering at least Engineer and Project Manager scenarios before building the production orchestration path. It should include:

- Clear, ambiguous, and contradictory daily statements.
- Existing task matches versus true new work.
- Parent/subtask decomposition.
- Duplicate and stale Nifty data.
- Midday reprioritization and unplanned work.
- Reported blockers without provider evidence.
- Provider evidence that conflicts with self-report.
- Missed, snoozed, and break-suppressed check-ins.
- Stale or unavailable providers.
- Prompt injection inside task descriptions and external provider text.
- Cross-employee and cross-organization data-isolation attempts.

Score system quality, not employee performance:

- Schema validity.
- Task-match precision and duplicate-creation rate.
- Unsupported-claim and incorrect-reference rate.
- Proposal acceptance, edit, and rejection rate.
- Abstention correctness.
- EOD reconciliation accuracy.
- Prompt relevance and interruption rate.
- Latency, token use, and cost per operation.
- Provider-write and readback failure rate.

Go/no-go thresholds must be chosen before the pilot. High reasoning is retained only where the evaluation shows a material quality benefit.

## Proposed delivery sequence after approval

This sequence is planning guidance only:

1. Reconcile Phase 1 acceptance with the prerequisite contract.
2. Approve policy decisions and data-retention boundaries.
3. Define role, responsibility, check-in, reconciliation, and AI-run contracts.
4. Build the sealed evaluation set and deterministic baselines.
5. Add Project Manager and custom-role onboarding.
6. Add daily-intent inference and reviewable task proposals.
7. Add the deterministic check-in scheduler and role templates.
8. Add model-generated contextual check-ins.
9. Add deterministic EOD reconciliation.
10. Add referenced EOD narrative generation.
11. Pilot with Engineer and Project Manager roles.
12. Consider Sales only after its evidence-provider contract is approved.

## Decisions required before implementation

- Is check-in cadence globally fixed, role-specific, or manager configurable within bounds?
- What snooze, skip, break, meeting, final-hour, and missed-response rules apply?
- What check-in and EOD data may managers see, and for how long?
- What action, if any, follows repeated missed check-ins? The model cannot decide this policy.
- Which responsibility fields employees may edit and which are organization-controlled?
- Which providers establish calls, emails, appointments, deals, code output, and project decisions?
- Which provider facts may be self-reported when no integration exists, and how are they labeled?
- What OpenRouter team account owns the production key, budget, alerts, rotation, and incident response?
- What latency and cost budgets apply to each operation?
- What evaluation thresholds must pass before employee and organization expansion?

The unresolved OpenRouter team login is not a blocker for documentation or deterministic design. It is a production-readiness blocker: personal credits and a personal key must not become an undocumented production dependency.

## Phase 2 acceptance contract

Phase 2 is not complete until native Windows and browser acceptance demonstrate that:

1. An employee can clock in, answer one daily-intent question, and review the resulting focus and task proposals without entering a duplicate goal.
2. Accepted task operations are reflected in Nifty and verified by readback; rejected operations do nothing.
3. Engineer, Project Manager, and custom-role responsibilities generate relevant, traceable check-ins.
4. Required check-ins obey clock-in, break, snooze, final-hour, and clock-out policy without duplicate prompts.
5. A missed response is represented as missing data and never as a productivity conclusion.
6. EOD Review deterministically reconciles planned, added, completed, progressed, deferred, carried, blocked, not-evidenced, and unknown work.
7. AI-generated text contains valid claim-level references or falls back to deterministic prose.
8. OpenRouter/model failure leaves the non-AI daily workflow usable and visibly degraded.
9. Model, reasoning effort, prompt/schema version, references, cost, latency, and user decision are auditable for every AI run.
10. RLS and tool scopes prevent cross-employee and cross-organization disclosure or mutation.
11. Evaluation thresholds pass for Engineer and Project Manager before another role is enabled.

Voice, avatar behavior, automatic performance judgments, and broad multi-role rollout are not required for this Phase 2 acceptance contract.
