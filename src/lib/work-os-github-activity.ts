import { getPool } from "@/lib/db/pool";

/* Attributed GitHub activity for one person in one window.
 *
 * Two relationships are kept distinct, because they mean different things:
 *   performed — an event the employee's own verified GitHub accounts did
 *               (pushes, pull requests, reviews, issues).
 *   triggered — an event produced by their work but performed by the provider
 *               or another person (CI runs for their commits, deployments,
 *               reviews/merges on their pull requests). Tightly linked: a
 *               workflow run only counts when its head commit is one the
 *               employee pushed inside the same window.
 *
 * The module is read-only and bounded; callers gate it on the org's
 * `github_evidence` flag. It never writes evidence, check-ins, or cadence. */

export type GithubActivityKind = "push" | "pull_request" | "review" | "workflow_run" | "deployment" | "issue";
export type GithubActivityRelation = "performed" | "triggered";

export interface GithubActivityItem {
  kind: GithubActivityKind;
  relation: GithubActivityRelation;
  /** Short factual phrase safe to show in a prompt or card. */
  description: string;
  url: string | null;
  at: string;
  repository: string | null;
  /** Login of the account that performed the event, when known. */
  actor: string | null;
}

export interface GithubActivityCounts {
  performed: Record<GithubActivityKind, number>;
  triggered: Record<GithubActivityKind, number>;
  commitsPushed: number;
}

export interface GithubActivity {
  items: GithubActivityItem[];
  counts: GithubActivityCounts;
  scanned: number;
  capped: boolean;
  identities: { logins: string[]; ids: string[] };
}

export interface GithubIdentitySet {
  logins: Set<string>;
  ids: Set<string>;
}

/** One row of the bounded window scan; raw subjects are projected in SQL so a
 * full webhook payload never has to be loaded. */
export interface GithubActivityRow {
  person_id: string | null;
  occurred_at: string | Date;
  title: string | null;
  artifact_url: string | null;
  event: string | null;
  action: string | null;
  repository: string | null;
  actor_id: string | null;
  actor_login: string | null;
  run_head_sha: string | null;
  run_head_branch: string | null;
  pr_user_login: string | null;
  pr_user_id: string | null;
  pr_number: string | null;
  pr_title: string | null;
  issue_user_login: string | null;
  issue_user_id: string | null;
  issue_number: string | null;
  issue_title: string | null;
  deployment_creator_login: string | null;
  deployment_ref: string | null;
  deployment_state: string | null;
  review_state: string | null;
  review_url: string | null;
  push_after: string | null;
  push_commit_ids: unknown;
  push_size: number | string | null;
}

export const EMPTY_GITHUB_COUNTS: GithubActivityCounts = {
  performed: { push: 0, pull_request: 0, review: 0, workflow_run: 0, deployment: 0, issue: 0 },
  triggered: { push: 0, pull_request: 0, review: 0, workflow_run: 0, deployment: 0, issue: 0 },
  commitsPushed: 0,
};

const GITHUB_ACTIVITY_LIMIT = 300;
const GITHUB_BLOCK_CHARS = 1_200;
const GITHUB_HIGHLIGHTS = 8;
const MAX_ITEM_CHARS = 200;

function clean(value: unknown, max = MAX_ITEM_CHARS): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isoInstant(value: unknown): string {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value ?? "");
}

function shortRepo(fullName: unknown): string | null {
  const name = clean(fullName, 120);
  if (!name) return null;
  return name;
}

/** Verified logins for the person's accounts plus the numeric actor ids seen on
 * their attributed events; the two are needed because accounts store logins
 * while events carry numeric ids. */
export async function listGithubIdentities(organizationId: string, personId: string): Promise<GithubIdentitySet> {
  const logins = new Set<string>();
  const ids = new Set<string>();
  const pool = getPool();
  const accounts = await pool.query(
    `select external_account_id, metadata->>'login' as login
       from work_source_accounts
      where organization_id = $1 and person_id = $2 and provider = 'github' and verified = true`,
    [organizationId, personId],
  );
  for (const row of accounts.rows as Array<{ external_account_id: string | null; login: string | null }>) {
    for (const value of [row.external_account_id, row.login]) {
      const login = clean(value, 80).toLowerCase();
      if (login) logins.add(login);
    }
  }
  const events = await pool.query(
    `select distinct metadata->'actor'->>'id' as actor_id, lower(metadata->'actor'->>'login') as actor_login
       from work_evidence_events
      where organization_id = $1 and person_id = $2 and provider = 'github'
        and metadata->'actor' is not null
      limit 40`,
    [organizationId, personId],
  );
  for (const row of events.rows as Array<{ actor_id: string | null; actor_login: string | null }>) {
    const id = clean(row.actor_id, 40);
    if (id) ids.add(id);
    const login = clean(row.actor_login, 80);
    if (login) logins.add(login);
  }
  return { logins, ids };
}

export function isPersonActor(identities: GithubIdentitySet, login: unknown, id: unknown): boolean {
  const normalizedLogin = clean(login, 80).toLowerCase();
  if (normalizedLogin && identities.logins.has(normalizedLogin)) return true;
  const normalizedId = clean(id, 40);
  return Boolean(normalizedId && identities.ids.has(normalizedId));
}

function commitIdsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const sha = clean(entry, 64).toLowerCase();
    return sha ? [sha] : [];
  });
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Classifies one stored GitHub event for one person. Pure so the window scan
 * and the tests share exactly one truth. */
export function classifyGithubEvent(
  row: GithubActivityRow,
  identities: GithubIdentitySet,
  pushedShas: Set<string>,
): GithubActivityItem | null {
  const event = clean(row.event, 40);
  const at = isoInstant(row.occurred_at);
  const repository = shortRepo(row.repository);
  const actor = clean(row.actor_login, 80) || null;
  const performed = isPersonActor(identities, row.actor_login, row.actor_id);
  const base = { at, repository, actor };
  if (event === "push") {
    if (!performed) return null;
    const commits = Number(row.push_size) || 0;
    return {
      ...base,
      kind: "push",
      relation: "performed",
      description: `Pushed ${countLabel(commits, "commit")} to ${repository ?? "the repository"}`,
      url: clean(row.artifact_url, 400) || null,
    };
  }
  if (event === "pull_request") {
    const number = clean(row.pr_number, 12);
    const title = clean(row.pr_title, 140);
    const label = number ? `#${number}` : "a pull request";
    if (performed) {
      const action = clean(row.action, 20) || "updated";
      return {
        ...base,
        kind: "pull_request",
        relation: "performed",
        description: `Pull request ${label}${title ? ` (${title})` : ""} ${action}`,
        url: clean(row.artifact_url, 400) || null,
      };
    }
    if (isPersonActor(identities, row.pr_user_login, row.pr_user_id)) {
      const action = clean(row.action, 20) || "updated";
      return {
        ...base,
        kind: "pull_request",
        relation: "triggered",
        description: `Your pull request ${label}${title ? ` (${title})` : ""} was ${action}${actor ? ` by ${actor}` : ""}`,
        url: clean(row.artifact_url, 400) || null,
      };
    }
    return null;
  }
  if (event === "pull_request_review") {
    const number = clean(row.pr_number, 12);
    const label = number ? `#${number}` : "a pull request";
    const state = clean(row.review_state, 30) || "submitted";
    const url = clean(row.review_url, 400) || clean(row.artifact_url, 400) || null;
    if (performed) {
      return {
        ...base,
        kind: "review",
        relation: "performed",
        description: `Submitted a ${state} review on pull request ${label}`,
        url,
      };
    }
    if (isPersonActor(identities, row.pr_user_login, row.pr_user_id)) {
      return {
        ...base,
        kind: "review",
        relation: "triggered",
        description: `Your pull request ${label} received a ${state} review${actor ? ` from ${actor}` : ""}`,
        url,
      };
    }
    return null;
  }
  if (event === "workflow_run") {
    const name = clean(row.title, 120).replace(/^Workflow\s+/i, "") || "Workflow run";
    const branch = clean(row.run_head_branch, 80);
    const sha = clean(row.run_head_sha, 64).toLowerCase();
    const linked = Boolean(sha && pushedShas.has(sha));
    if (!linked && !performed) return null;
    const relation: GithubActivityRelation = linked ? "triggered" : "performed";
    return {
      ...base,
      kind: "workflow_run",
      relation,
      description: linked
        ? `CI for your commit on ${branch || "your branch"}: ${name}`
        : `${name}${branch ? ` (${branch})` : ""}`,
      url: clean(row.artifact_url, 400) || null,
    };
  }
  if (event === "deployment_status") {
    const state = clean(row.deployment_state, 30) || "updated";
    const linked = isPersonActor(identities, row.deployment_creator_login, null);
    if (!linked) return null;
    return {
      ...base,
      kind: "deployment",
      relation: "triggered",
      description: `Deployment ${state}${repository ? ` for ${repository}` : ""}`,
      url: clean(row.artifact_url, 400) || null,
    };
  }
  if (event === "issues") {
    const number = clean(row.issue_number, 12);
    const title = clean(row.issue_title, 140);
    const label = number ? `#${number}` : "an issue";
    if (performed) {
      const action = clean(row.action, 20) || "updated";
      return {
        ...base,
        kind: "issue",
        relation: "performed",
        description: `Issue ${label}${title ? ` (${title})` : ""} ${action}`,
        url: clean(row.artifact_url, 400) || null,
      };
    }
    if (isPersonActor(identities, row.issue_user_login, row.issue_user_id)) {
      const action = clean(row.action, 20) || "updated";
      return {
        ...base,
        kind: "issue",
        relation: "triggered",
        description: `Your issue ${label}${title ? ` (${title})` : ""} was ${action}${actor ? ` by ${actor}` : ""}`,
        url: clean(row.artifact_url, 400) || null,
      };
    }
    return null;
  }
  return null;
}

export function tallyGithubActivity(items: GithubActivityItem[]): GithubActivityCounts {
  const counts: GithubActivityCounts = {
    performed: { ...EMPTY_GITHUB_COUNTS.performed },
    triggered: { ...EMPTY_GITHUB_COUNTS.triggered },
    commitsPushed: 0,
  };
  for (const item of items) {
    counts[item.relation][item.kind] += 1;
    if (item.kind === "push" && item.relation === "performed") {
      const commits = Number(/(\d+)/.exec(item.description)?.[1] ?? 0) || 0;
      counts.commitsPushed += commits;
    }
  }
  return counts;
}

const HIGHLIGHT_ORDER: Record<GithubActivityRelation, GithubActivityKind[]> = {
  performed: ["pull_request", "push", "review", "issue", "workflow_run", "deployment"],
  triggered: ["pull_request", "deployment", "review", "workflow_run", "issue", "push"],
};

/** Most meaningful first: performed authored work, then consequences. */
export function pickGithubHighlights(items: GithubActivityItem[], limit = GITHUB_HIGHLIGHTS): GithubActivityItem[] {
  const rank = (item: GithubActivityItem) => HIGHLIGHT_ORDER[item.relation].indexOf(item.kind);
  return [...items]
    .sort((left, right) => {
      if (left.relation !== right.relation) return left.relation === "performed" ? -1 : 1;
      const byKind = rank(left) - rank(right);
      if (byKind !== 0) return byKind;
      return right.at.localeCompare(left.at);
    })
    .slice(0, limit);
}

function tallyLine(counts: GithubActivityCounts): string | null {
  const parts: string[] = [];
  const performed = counts.performed;
  if (performed.push) parts.push(`${countLabel(performed.push, "push", "pushes")} (${countLabel(counts.commitsPushed, "commit")})`);
  if (performed.pull_request) parts.push(countLabel(performed.pull_request, "pull request"));
  if (performed.review) parts.push(countLabel(performed.review, "review"));
  if (performed.issue) parts.push(countLabel(performed.issue, "issue"));
  const triggered = counts.triggered;
  const triggeredParts: string[] = [];
  if (triggered.workflow_run) triggeredParts.push(countLabel(triggered.workflow_run, "workflow run"));
  if (triggered.deployment) triggeredParts.push(countLabel(triggered.deployment, "deployment"));
  if (triggered.pull_request) triggeredParts.push(countLabel(triggered.pull_request, "pull request update"));
  if (triggered.review) triggeredParts.push(countLabel(triggered.review, "review received"));
  if (triggered.issue) triggeredParts.push(countLabel(triggered.issue, "issue update"));
  const lines: string[] = [];
  if (parts.length) lines.push(`Performed by this employee: ${parts.join(", ")}.`);
  if (triggeredParts.length) lines.push(`Triggered by their work: ${triggeredParts.join(", ")}.`);
  return lines.length ? lines.join(" ") : null;
}

/** Prompt-ready block, bounded so it can never crowd out the screenshot
 * evidence. Returns an empty string when nothing was recorded. */
export function formatGithubActivityBlock(activity: GithubActivity): string {
  const summary = tallyLine(activity.counts);
  if (!summary) return "";
  const highlights = pickGithubHighlights(activity.items).map((item) =>
    `- [${item.relation}] ${item.description}${item.repository ? ` — ${item.repository}` : ""}${item.url ? ` (${item.url})` : ""}`);
  const lines = [summary, ...(highlights.length ? ["Highlights:", ...highlights] : [])];
  let block = lines.join("\n");
  if (block.length > GITHUB_BLOCK_CHARS) {
    block = block.slice(0, GITHUB_BLOCK_CHARS);
    const lastBreak = block.lastIndexOf("\n");
    if (lastBreak > 0) block = block.slice(0, lastBreak);
  }
  return block;
}

/** Reads the bounded window once and classifies every event for the person.
 * Performed events come from the person's own attributed rows; consequence
 * events are matched by the subject stored on the raw payload. */
export async function listGithubActivity(input: {
  organizationId: string;
  personId: string;
  windowStart: string;
  windowEnd: string;
  limit?: number;
}): Promise<GithubActivity> {
  const identities = await listGithubIdentities(input.organizationId, input.personId);
  const empty: GithubActivity = {
    items: [],
    counts: { ...EMPTY_GITHUB_COUNTS, performed: { ...EMPTY_GITHUB_COUNTS.performed }, triggered: { ...EMPTY_GITHUB_COUNTS.triggered } },
    scanned: 0,
    capped: false,
    identities: { logins: [...identities.logins], ids: [...identities.ids] },
  };
  if (!identities.logins.size && !identities.ids.size) return empty;
  const limit = Math.max(1, Math.min(GITHUB_ACTIVITY_LIMIT, Math.floor(input.limit ?? GITHUB_ACTIVITY_LIMIT)));
  const rows = await getPool().query(
    `select person_id,
            occurred_at,
            title,
            artifact_url,
            metadata->>'event' as event,
            metadata->>'action' as action,
            metadata->>'repository' as repository,
            metadata->'actor'->>'id' as actor_id,
            metadata->'actor'->>'login' as actor_login,
            raw->'workflow_run'->>'head_sha' as run_head_sha,
            raw->'workflow_run'->>'head_branch' as run_head_branch,
            raw->'pull_request'->'user'->>'login' as pr_user_login,
            raw->'pull_request'->'user'->>'id' as pr_user_id,
            raw->'pull_request'->>'number' as pr_number,
            raw->'pull_request'->>'title' as pr_title,
            raw->'issue'->'user'->>'login' as issue_user_login,
            raw->'issue'->'user'->>'id' as issue_user_id,
            raw->'issue'->>'number' as issue_number,
            raw->'issue'->>'title' as issue_title,
            raw->'deployment'->'creator'->>'login' as deployment_creator_login,
            raw->'deployment'->>'ref' as deployment_ref,
            raw->'deployment_status'->>'state' as deployment_state,
            raw->'review'->>'state' as review_state,
            raw->'review'->>'html_url' as review_url,
            raw->>'after' as push_after,
            raw->'size' as push_size,
            coalesce((select jsonb_agg(commit->>'id') from jsonb_array_elements(coalesce(raw->'commits', '[]'::jsonb)) commit), '[]'::jsonb) as push_commit_ids
       from work_evidence_events
      where organization_id = $1
        and provider = 'github'
        and occurred_at >= $2
        and occurred_at < $3
      order by occurred_at asc
      limit $4`,
    [input.organizationId, input.windowStart, input.windowEnd, limit],
  );
  const windowRows = rows.rows as GithubActivityRow[];
  const pushedShas = new Set<string>();
  for (const row of windowRows) {
    if (clean(row.event, 40) !== "push") continue;
    if (!isPersonActor(identities, row.actor_login, row.actor_id)) continue;
    const shas = [row.push_after, ...commitIdsFrom(row.push_commit_ids)];
    for (const sha of shas) {
      const normalized = clean(sha, 64).toLowerCase();
      if (normalized) pushedShas.add(normalized);
    }
  }
  const items: GithubActivityItem[] = [];
  for (const row of windowRows) {
    const item = classifyGithubEvent(row, identities, pushedShas);
    if (item) items.push(item);
  }
  return {
    items,
    counts: tallyGithubActivity(items),
    scanned: windowRows.length,
    capped: windowRows.length >= limit,
    identities: { logins: [...identities.logins], ids: [...identities.ids] },
  };
}

/** The allowlist the interval parser validates `recorded_activity` against, so
 * the model can never fabricate an item that was not recorded. */
export interface RecordedActivityAllowlistEntry {
  description: string;
  relation: GithubActivityRelation;
  url: string | null;
}

export function githubRecordedActivityAllowlist(activity: GithubActivity): RecordedActivityAllowlistEntry[] {
  return activity.items.map((item) => ({ description: item.description, relation: item.relation, url: item.url }));
}

/** EOD-ready observed lines: a tally plus a few concrete highlights. */
export function githubObservedLines(activity: GithubActivity, limit = 6): string[] {
  const summary = tallyLine(activity.counts);
  if (!summary) return [];
  const lines = [summary];
  for (const item of pickGithubHighlights(activity.items, limit)) {
    lines.push(`${item.description}${item.repository ? ` — ${item.repository}` : ""}${item.url ? ` (${item.url})` : ""}`);
  }
  return lines;
}
