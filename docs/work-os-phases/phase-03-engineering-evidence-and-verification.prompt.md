# Phase 3 Prompt — Software Engineering Evidence and Verification

You are implementing Phase 3 of the Work OS desktop companion pilot in `/home/maigreeks/projects/work-os`. Phases 1 and 2 must already provide a trustworthy work-session lifecycle, daily plan, text/voice claims, adaptive prompts, and reviewable Nifty proposals.

The sole pilot employee is David, a software engineer. Evidence sources in scope are the local repositories and development artifacts available to Agent OS, Nifty, GitHub, deployment/CI artifacts available through GitHub, and Worktivity. Do not add GHL or non-engineering evaluation logic.

This phase must extend the existing Agent OS cloud-to-machine bridge in `/home/maigreeks/projects/agent-os`; do not create a second agent queue. Agent OS already enqueues RLS-scoped `jobs`/`runs`, dispatches special job kinds in `scripts/agent-runner.ts`, and invokes the local Codex CLI. Use that mechanism to run narrowly scoped, read-only work-evidence investigations programmatically.

Follow `AGENTS.md`, preserve unrelated work, reuse or create the Nifty ledger task before implementation, inspect the existing provider webhook/evidence/screenshot code, and read relevant installed framework documentation before modifying APIs.

## Objective

Build an evidence engine that tests software-engineering work claims by queuing a bounded Codex investigation on the Agent OS runner. The verifier should inspect authorized repository artifacts first, correlate them with provider records, and keep employee claims, observations, source artifacts, and agent conclusions distinct. The result is an explainable evidence status—not a productivity score and not an automated accusation.

## Deliverables

### 1. Canonical work-claim ledger

Create a first-class claim model linked to the original check-in/transcript, employee, work session, task, and report date. Support:

```ts
type ClaimStatus =
  | "self_reported"
  | "confirmed"
  | "partially_supported"
  | "contradicted"
  | "insufficient_evidence"
  | "not_externally_verifiable";
```

Every status must include an explanation, evidence references, verifier version, confidence, and timestamp. Confidence is not truth. Preserve corrections and disputes as append-only history.

### 2. Verified identity and source boundaries

Map David's verified GitHub account to his Work OS person record. Reject attribution when an account is shared, ambiguous, unverified, outside the configured organization/repository scope, or not active during the evidence window.

Maintain organization/person RLS boundaries. Webhooks must be signature-verified, idempotent, replay-safe, and auditable. Store only the provider payload required for traceability and future correction.

### 3. GitHub engineering evidence

Use existing GitHub webhook foundations and add any missing handling for:

- Commits or pushed branches where attribution is reliable.
- Pull request creation, updates, reviews, merges, and closures.
- Issue/task linkage.
- CI workflow results.
- Deployment status.
- Review comments where they represent substantive output.

Normalize these as `output_evidence`. A commit, PR, or passing CI run may support progress, but none automatically proves that a business outcome is complete.

### 4. Nifty task evidence

Use Nifty as the authoritative task state. Reconcile:

- Task identity and assignee.
- Expected outcome and definition of done.
- Status and completion.
- Progress updates.
- Blockers and dependencies.
- Links to GitHub artifacts.

Detect stale claims and stale proposals when the underlying Nifty task changes. Do not overwrite Nifty state during verification.

### 5. Agent OS Codex evidence job

Add a dedicated job kind such as `work_os_evidence_verification` to the existing Agent OS queue and runner dispatcher. Build a typed server-side enqueue helper rather than letting the desktop construct raw Codex arguments.

The request contract should carry stable identifiers and bounded scope, for example:

```ts
interface WorkEvidenceVerificationRequest {
  verificationRunId: string;
  claimId: string;
  organizationId: string;
  personId: string;
  sessionId: string;
  taskId?: string;
  repositoryId: string;
  window: { start: string; end: string };
  question: string;
  allowedSources: Array<"repository" | "nifty" | "github" | "worktivity">;
  evidenceVersion: string;
  promptVersion: string;
}
```

Resolve `repositoryId` to an administrator-approved absolute path on the server. Never accept an arbitrary `cwd`, filesystem path, command, or Codex argv from the desktop payload. Reject repositories outside the allowlist and cross-organization/person claims before enqueueing.

Use `buildCodex` with `sandbox: "read-only"` and an ephemeral invocation where supported. The verifier must not edit files, install dependencies, run deployment commands, update Nifty/GitHub, or write into the inspected repository. Allow only explicitly approved, non-mutating inspection commands and reads.

The runner should be able to inspect, when relevant and authorized:

- Git branch, status, log, commits, and diff metadata inside the evidence window.
- Changed source and test files related to the stated task.
- Existing build, test, CI, deployment, or review artifacts without rerunning mutating workflows.
- Nifty task state and linked GitHub artifacts supplied through normalized evidence records.
- Worktivity-derived project/app context only when it helps locate the relevant repository or time window.

Codex task/conversation history is not a default evidence source. Add it only after an explicit privacy decision and a scoped contract defining which task metadata or transcripts may be read.

### 6. Structured verifier result and provenance

Require strict structured output, validate it before persistence, and abstain on malformed or insufficient results. The result must include:

```json
{
  "claim_id": "...",
  "status": "partially_supported",
  "confidence": 0.78,
  "explanation": "Relevant implementation changes and tests were found, but no deployment evidence was available.",
  "source_evidence_ids": ["..."],
  "gaps": ["No deployment record found"],
  "contradictions": [],
  "inspected_repositories": ["work-os"],
  "inspection_actions": ["git log", "git diff", "read test report"],
  "started_at": "...",
  "finished_at": "...",
  "verifier_version": "..."
}
```

Persist the verification run separately from raw evidence. Mirror the conclusion into the Work OS claim ledger as an assessment referencing immutable source evidence IDs; never classify the Codex opinion itself as the underlying output artifact.

Use an idempotency key derived from claim ID, evidence version, repository scope, and prompt version. Bound concurrency, execution time, retries, and output size. Support cancellation and runner-restart recovery. A new evidence version may supersede an old assessment but must not overwrite its history.

Queue verification only after a substantive progress/completion claim, near EOD for unresolved material claims, or by explicit employee request. Do not investigate continuously or trigger an agent every hour merely because a reminder fired.

### 7. Worktivity as secondary context

Use Worktivity only as optional `activity_observation` and routing context:

- Application/project context.
- Sustained activity windows.
- Gaps or context switches relevant to evidence discovery.
- Suggestions about which repository, project, or evidence window the Codex job should inspect.

Do not infer correctness, completion, quality, or productive hours from screenshot volume, active seconds, keystrokes, or application presence. Do not make screenshot analysis the default verification mechanism. Keep screenshot summaries opt-in, consent-gated, encrypted, private, redacted, and retention-bounded. Prefer repository and delivery artifacts; use Worktivity metadata to corroborate or locate them.

### 8. Narrow verification questions

Generate bounded questions for the Agent OS Codex job. Example:

```json
{
  "question": "Was meaningful progress made on the desktop debugger task during this session?",
  "claim_id": "...",
  "window": { "start": "...", "end": "..." },
  "repository_id": "work-os",
  "allowed_sources": ["repository", "nifty", "github", "worktivity"],
  "result": {
    "status": "partially_supported",
    "confidence": 0.78,
    "explanation": "A related PR and successful build were observed, but no deployment was found.",
    "evidence_ids": ["..."]
  }
}
```

Each request must be read-only, time-bounded, repository/provider-scoped, retry-safe, and prohibited from broad employee investigation. Record the exact question, path mapping, commands/reads, and sources used. If the available artifacts cannot answer the question, return `insufficient_evidence` rather than expanding scope silently.

### 9. Employee evidence review

Expose to David:

- His original claim.
- Supporting and conflicting evidence.
- Source links.
- Confidence and explanation.
- Missing evidence.
- Correction/dispute controls.
- The downstream Nifty or EOD proposal affected by the conclusion.

Never hide the evidence used to characterize his work. Manager views must inherit the same provenance.

### 10. Anti-gaming and anti-overclaiming rules

Document and enforce that:

- Activity volume is not impact.
- Many commits are not inherently better than one correct change.
- Generated or mechanical changes require the same outcome verification.
- CI failure may contradict “ready to deploy” but not necessarily “implemented.”
- A merged PR may support delivery but not production impact without deployment/usage evidence.
- Lack of external evidence is not proof of inactivity.

Do not produce a single employee productivity score.

## Verification

Test webhook signatures, replay/idempotency, cross-organization isolation, identity ambiguity, stale-task handling, evidence classification, correction history, verifier time/source bounds, repository allowlisting, and screenshot policy. Add fixtures for confirmed, partial, contradictory, self-reported, and unverifiable claims.

Add explicit Agent OS queue tests for arbitrary `cwd` rejection, server-side repository resolution, read-only Codex arguments, duplicate enqueue suppression, timeout/cancellation, runner restart, malformed Codex output, stale evidence versions, and proof that the inspected worktree remains unchanged.

Run a real pilot trace for one David engineering task from stated plan through Nifty mapping, queued Agent OS Codex inspection, repository/GitHub artifacts, optional Worktivity routing context, and evidence conclusion. Redact secrets but retain job/run IDs, source IDs, inspected scope, and timestamps in the handoff.

## Definition of done

Phase 3 is complete only when:

1. David's GitHub identity is verified and scoped to approved repositories.
2. Work OS can enqueue a typed `work_os_evidence_verification` job through the existing Agent OS `jobs`/`runs` bridge.
3. The runner resolves only allowlisted repositories and invokes Codex in read-only mode.
4. Signed GitHub events are ingested idempotently and attributed correctly.
5. Repository, Nifty, GitHub, Worktivity, and verifier-assessment records remain distinct.
6. At least one real claim is confirmed or partially supported with clickable provenance.
7. At least one insufficient/ambiguous case abstains rather than inventing certainty.
8. David can inspect, correct, or dispute the evidence conclusion.
9. Verification cannot mutate the repository, Nifty, GitHub, or task state.
10. RLS, allowlist, idempotency, cancellation, encryption, retention, webhook, and replay tests pass.
11. The system never reports activity volume as productivity or impact.

## Needed to proceed that is not already available in `.env.local`

The current `.env.local` already contains `WORKTIVITY_API_KEY`, `OPENAI_API_KEY`, Nifty credentials, Supabase credentials, and `WORK_OS_PROVIDER_SECRET_KEY`.

The following secrets are missing and are required only for the enabled evidence features:

- `WORK_OS_GITHUB_WEBHOOK_SECRET` for signed GitHub webhook ingestion.
- `WORK_OS_SCREENSHOT_ENCRYPTION_KEY` if Worktivity screenshot summaries are enabled.
- `CRON_SECRET` if retained screenshot deletion is enabled.

`WORK_OS_SCREENSHOT_MODEL` and `WORK_OS_AI_MODEL` may use documented defaults, but explicit production model choices should be configured for reproducibility.

The following external setup is also required:

- A running `agentos-runner` service on the Agent OS execution host and a locally authenticated Codex CLI. No additional Codex API secret is required if the existing local CLI authentication remains valid.
- An administrator-approved mapping from Work OS repository IDs to absolute local repository roots for David. Start with the exact repositories in this pilot; do not allow arbitrary paths.
- A decision on whether Codex may inspect only repository/build artifacts or also narrowly scoped Agent OS task/session history. Default to repository artifacts only.
- Execution limits for each verifier job: timeout, concurrency, retry count, maximum output, and cancellation behavior.
- GitHub organization/repository admin access to register the webhook endpoint.
- David's GitHub account ID/login and explicit source-account verification.
- The approved list of repositories and GitHub event types.
- The public webhook URL reachable from GitHub.
- David's Worktivity employee mapping, tracking consent, and sensitive app/domain exclusions if Worktivity context is enabled.
- A decision on whether screenshot summaries are enabled at all. They are optional and disabled by default for this engineering pilot; repository verification can proceed without screenshot encryption or retention secrets.
- A written evidence-retention and employee-dispute policy.

No GHL credential or webhook key is needed for this software-engineer phase.
