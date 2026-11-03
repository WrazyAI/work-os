/* Deterministic EOD report contract.
 *
 * The report is a manager brief followed by a complete record. Nothing here
 * calls a model: the same facts always produce the same document. The AI is
 * kept for the employee's own refinement request, never for deciding what the
 * day contained.
 *
 * Two rules shape the document:
 *   1. The brief is capped and ranked. A completed-task ledger is not a
 *      manager brief.
 *   2. Nothing is hidden. Every fact the brief leaves out stays in the
 *      `## Full record` appendix with its provenance.
 */

import { clipText, collapseAutomation, formatLocalTime, formatReportDate, humanizeGoalSource } from "@/lib/work-os-eod-facts";

export type EodTaskKind = "work" | "personal" | "test" | "administrative";

export interface EodTaskFact {
  id: string;
  title: string;
  project: string | null;
  /** Exact completion instant when the provider recorded one; otherwise the
   * instant Work OS observed the change. */
  at: string | null;
  /** True only when the timestamp is an exact provider or employee instant.
   * Provider-observed sync times never become work times. */
  exact: boolean;
  /** "(outside shift)" / "(outside the workday)" when the workday window
   * proves this finished outside it. */
  outsideLabel: string | null;
}

export interface EodPlanItem {
  id: string;
  taskId: string | null;
  kind: string;
  title: string;
  disposition: string;
  completionState: string;
  blocker: string | null;
}

export interface EodRecap {
  label: string;
  headline: string | null;
  detail: string;
  /** confirmed | amended | inferred */
  provenance: string;
  startIso: string;
  endIso: string;
}

export interface EodGithubFacts {
  performed: { push: number; pullRequest: number; review: number; issue: number };
  triggered: { workflowRun: number; deployment: number; pullRequest: number; review: number; issue: number };
  commits: number;
  /** Unique performed pull requests, e.g. "work-os#134". */
  pullRequests: string[];
}

export interface EodMediaFact {
  title: string;
  url: string;
  durationSeconds: number | null;
  digest: string | null;
}

export interface EodEvidenceFact {
  title: string;
  summary: string;
  url: string | null;
  source: string;
  taskId: string | null;
}

export interface EodReportFacts {
  date: string;
  personName: string;
  timezone: string;
  roleName: string | null;
  goal: { text: string | null; provenance: string | null };
  session: { clockedInAt: string | null; clockedOutAt: string | null };
  completed: EodTaskFact[];
  carried: EodTaskFact[];
  automation: Array<{ title: string; outside: boolean }>;
  automationOutsideLabel: string | null;
  planItems: EodPlanItem[];
  updates: Array<{ kind: string; text: string }>;
  blockers: string[];
  recaps: EodRecap[];
  hourly: Array<{ label: string; summary: string }>;
  github: EodGithubFacts | null;
  media: EodMediaFact[];
  evidence: EodEvidenceFact[];
}

export interface EodReportMetrics {
  completed: number;
  deliverables: number;
  automation: number;
  progressed: number;
  deferred: number;
  carried: number;
  unplanned: number;
}

const PERSONAL_PROJECT = /(^|\b)(personal|life admin|home|errands?|chores?)(\b|$)/i;
const TEST_PROJECT = /(^|\b)(test|testing|scratch|qa|fixture)(\b|$)/i;
const TEST_TITLE = /^(random test|test task|scratch\b|sample\b|fixture\b|qa\b)/i;
/* These are the personal chores that have appeared in the ledger without a
 * personal project. They are a conservative fallback until a task can carry an
 * explicit personal/test label; anything else stays a work deliverable. */
const PERSONAL_TITLE = /^(choose a walking route|choose suitable herbs|collect the book list|create a shot list|design a relaxing evening routine|experiment with a smoothie recipe|organize a digital bookshelf|plan a weekend photo walk|prepare the containers|select the ingredients|set up a small herb garden)\b/i;

export function normalizeEodTitle(value: string): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function administrativeTitle(title: string, personName: string): boolean {
  const escaped = personName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\s*\\d{1,2}\\/\\d{1,2}\\/\\d{4}$`, "i").test(title.trim());
}

export function classifyEodTask(title: string, project: string | null, personName: string): EodTaskKind {
  if (administrativeTitle(title, personName) || (project ? /^eod report$/i.test(project.trim()) : false)) return "administrative";
  if (TEST_TITLE.test(title) || (project ? TEST_PROJECT.test(project) : false)) return "test";
  if (PERSONAL_TITLE.test(title) || (project ? PERSONAL_PROJECT.test(project) : false)) return "personal";
  return "work";
}

export interface CollapsedEodTask extends EodTaskFact {
  count: number;
  kind: EodTaskKind;
}

/** Collapses repeated titles. Distinct tasks with the same name are one fact
 * for a reader; the count keeps the repetition truthful. */
export function collapseEodTasks(facts: EodTaskFact[], personName: string): CollapsedEodTask[] {
  const byTitle = new Map<string, CollapsedEodTask>();
  for (const fact of facts) {
    const titleKey = normalizeEodTitle(fact.title);
    if (!titleKey) continue;
    const kind = classifyEodTask(fact.title, fact.project, personName);
    // A title is only one row when it is the same kind of task in the same
    // project. A personal task and a work task that share a title are still
    // two facts, and the brief must not lose the work one.
    const key = `${titleKey}::${kind}::${fact.project ?? ""}`;
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, { ...fact, count: 1, kind });
      continue;
    }
    existing.count += 1;
    if (!existing.at) {
      existing.at = fact.at;
      existing.exact = fact.exact;
    } else if (fact.exact && !existing.exact) {
      // The timestamp and its precision travel together. A provider-observed
      // sync time must never be printed as an exact completion time.
      existing.at = fact.at;
      existing.exact = true;
    } else if (fact.exact && existing.exact && fact.at && existing.at && fact.at < existing.at) {
      existing.at = fact.at;
    }
    if (!existing.outsideLabel && fact.outsideLabel) existing.outsideLabel = fact.outsideLabel;
  }
  return [...byTitle.values()];
}

function planTaskIds(planItems: EodPlanItem[]): Set<string> {
  return new Set(planItems.map((item) => item.taskId).filter((id): id is string => Boolean(id)));
}

function planOutcomeTitles(planItems: EodPlanItem[]): Set<string> {
  return new Set(planItems.filter((item) => item.kind === "outcome").map((item) => normalizeEodTitle(item.title)));
}

/** Ranks completed work for the brief. The order is deterministic and
 * explainable: plan-linked first, then output evidence, then project context,
 * then exact/in-shift work. The appendix keeps the full list. */
export function rankEodCompleted(facts: EodReportFacts): CollapsedEodTask[] {
  const work = collapseEodTasks(facts.completed, facts.personName).filter((item) => item.kind === "work");
  const linkedIds = planTaskIds(facts.planItems);
  const outcomeTitles = planOutcomeTitles(facts.planItems);
  const evidenceTaskIds = new Set(facts.evidence.map((item) => item.taskId).filter((id): id is string => Boolean(id)));
  return work
    .map((item) => {
      let score = 0;
      if (linkedIds.has(item.id)) score += 100;
      if (outcomeTitles.has(normalizeEodTitle(item.title))) score += 100;
      if (evidenceTaskIds.has(item.id)) score += 40;
      if (item.project) score += 20;
      if (!item.outsideLabel) score += 10;
      if (item.exact) score += 5;
      return { item, score };
    })
    .sort((left, right) =>
      right.score - left.score
      || String(left.item.at ?? "9999").localeCompare(String(right.item.at ?? "9999"))
      || left.item.title.localeCompare(right.item.title))
    .map((entry) => entry.item);
}

export interface EodPlanMismatch {
  title: string;
  note: string;
}

/** Only a real disagreement between the stored plan and the task record. The
 * plan's full item list is never the report's job. */
export function eodPlanMismatches(facts: EodReportFacts, limit = 5): EodPlanMismatch[] {
  const completedIds = new Set(facts.completed.map((item) => item.id));
  const seen = new Set<string>();
  const mismatches: EodPlanMismatch[] = [];
  for (const item of facts.planItems) {
    if (item.kind !== "outcome" || !item.taskId) continue;
    const title = item.title.trim();
    const key = normalizeEodTitle(title);
    if (!title || seen.has(key)) continue;
    // The plan item is linked to one task. A same-titled task elsewhere is not
    // evidence that this commitment was completed.
    const taskCompleted = completedIds.has(item.taskId);
    if (taskCompleted && item.completionState !== "completed") {
      seen.add(key);
      mismatches.push({ title, note: "completed in the task record; the plan still shows it open." });
    } else if (!taskCompleted && item.completionState === "completed") {
      seen.add(key);
      mismatches.push({ title, note: "marked complete in the plan; no task completion was recorded." });
    }
    if (mismatches.length >= limit) break;
  }
  return mismatches;
}

export function eodBlockers(facts: EodReportFacts, limit = 5): string[] {
  const values = [
    ...facts.blockers,
    ...facts.planItems.filter((item) => item.kind === "outcome" && item.blocker).map((item) => `${item.title}: ${item.blocker}`),
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function firstSentence(value: string, max = 120): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

function listPhrase(values: string[]): string {
  const clean = values.filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function shortTitle(value: string, max = 96): string {
  return clipText(value, max);
}

function recapHeadline(recap: EodRecap): string {
  return clipText(recap.headline?.trim() || firstSentence(recap.detail), 120);
}

function recapProvenance(value: string): string {
  return value === "amended" ? "Updated by you" : value === "confirmed" ? "Confirmed" : "Inferred";
}

/** Confirmed or amended recaps that describe work the completed list does not
 * already name. A completion inside the interval does not by itself suppress
 * the recap: the recap may describe other work that never closed a task.
 * Inferred recaps stay in the appendix. */
export function eodProgressRecaps(facts: EodReportFacts, limit = 3): EodRecap[] {
  const completedTitles = facts.completed.map((item) => normalizeEodTitle(item.title)).filter(Boolean);
  return facts.recaps
    .filter((recap) => recap.provenance === "confirmed" || recap.provenance === "amended")
    .filter((recap) => recapHeadline(recap).length > 0)
    .filter((recap) => {
      const headline = normalizeEodTitle(recapHeadline(recap));
      return !completedTitles.some((title) => title.includes(headline) || headline.includes(title));
    })
    .slice(0, limit);
}

export function buildEodSummary(facts: EodReportFacts): string {
  const deliverables = rankEodCompleted(facts);
  const completed = facts.completed.length;
  const workCount = collapseEodTasks(facts.completed, facts.personName).filter((item) => item.kind === "work").length;
  const top = deliverables.slice(0, 3).map((item) => shortTitle(item.title));
  const progress = eodProgressRecaps(facts, 1)[0];
  const progressLine = progress ? `Recorded work also covered ${shortTitle(recapHeadline(progress), 110)}.` : "";

  if (!workCount) {
    if (!completed) return "No completed work was recorded today.";
    if (progress) return `No work deliverables were recorded today. Recorded work covered ${shortTitle(recapHeadline(progress), 110)}.`;
    return `No work deliverables were recorded today; the full record lists ${completed} completed task${completed === 1 ? "" : "s"}.`;
  }
  const lead = workCount === 1
    ? `Completed 1 work task today: ${top[0] ?? "1 task"}.`
    : workCount === 2
      ? `Completed 2 work tasks today: ${listPhrase(top.slice(0, 2))}.`
      : `Completed ${workCount} work tasks today, including ${listPhrase(top)}.`;
  return progressLine ? `${lead} ${progressLine}` : lead;
}

function taskLine(item: CollapsedEodTask, timezone: string, includeProject = true): string {
  const time = item.exact ? formatLocalTime(item.at, timezone) : null;
  const meta = [
    includeProject ? item.project : null,
    time,
    item.outsideLabel?.trim() ?? null,
  ].filter(Boolean).join(" · ");
  const title = item.count > 1 ? `${item.title} ×${item.count}` : item.title;
  if (!meta) return `- ${title}`;
  // A lone outside-window label follows the title; a project or time keeps the
  // em-dash track that the row splitter reads back.
  return item.project || time ? `- ${title} — ${meta}` : `- ${title} ${meta}`;
}

function recapLine(recap: EodRecap): string {
  return `- ${recap.label} — ${recapProvenance(recap.provenance)}: ${recapHeadline(recap)}`;
}

function githubEvidenceLine(facts: EodReportFacts): string | null {
  const github = facts.github;
  if (!github) return null;
  const performed: string[] = [];
  if (github.performed.push) {
    performed.push(github.commits
      ? `${github.performed.push} push${github.performed.push === 1 ? "" : "es"} (${github.commits} commit${github.commits === 1 ? "" : "s"})`
      : `${github.performed.push} push${github.performed.push === 1 ? "" : "es"}`);
  } else if (github.commits) {
    performed.push(`${github.commits} commit${github.commits === 1 ? "" : "s"}`);
  }
  if (github.pullRequests.length) performed.push(`${github.pullRequests.length} pull request${github.pullRequests.length === 1 ? "" : "s"}`);
  else if (github.performed.pullRequest) performed.push(`${github.performed.pullRequest} pull request event${github.performed.pullRequest === 1 ? "" : "s"}`);
  if (github.performed.review) performed.push(`${github.performed.review} review${github.performed.review === 1 ? "" : "s"}`);
  if (github.performed.issue) performed.push(`${github.performed.issue} issue${github.performed.issue === 1 ? "" : "s"}`);
  const triggered: string[] = [];
  if (github.triggered.workflowRun) triggered.push(`${github.triggered.workflowRun} workflow run${github.triggered.workflowRun === 1 ? "" : "s"}`);
  if (github.triggered.deployment) triggered.push(`${github.triggered.deployment} deployment${github.triggered.deployment === 1 ? "" : "s"}`);
  if (github.triggered.pullRequest) triggered.push(`${github.triggered.pullRequest} pull request update${github.triggered.pullRequest === 1 ? "" : "s"}`);
  if (github.triggered.review) triggered.push(`${github.triggered.review} review update${github.triggered.review === 1 ? "" : "s"}`);
  if (github.triggered.issue) triggered.push(`${github.triggered.issue} issue update${github.triggered.issue === 1 ? "" : "s"}`);
  const parts = [
    performed.length ? `performed ${performed.join(" · ")}` : "",
    triggered.length ? `triggered ${triggered.join(" · ")}` : "",
  ].filter(Boolean);
  return parts.length ? `- GitHub, provider-recorded — ${parts.join("; ")}.` : null;
}

function fullText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function evidenceSourceLabel(source: string): string {
  if (source === "manual") return "Employee-attached";
  if (source === "agent") return "Agent-recorded";
  if (source === "nifty") return "Nifty";
  return source || "Recorded";
}

function mediaLine(media: EodMediaFact): string {
  const length = Number.isFinite(media.durationSeconds) && (media.durationSeconds ?? 0) > 0
    ? ` (${Math.floor((media.durationSeconds as number) / 60)}:${String(Math.round((media.durationSeconds as number) % 60)).padStart(2, "0")})`
    : "";
  const digest = media.digest ? ` — ${fullText(media.digest)}` : "";
  return `- ${media.title}${length}${digest} — ${media.url}`;
}

export function buildEodReportMarkdown(facts: EodReportFacts): { markdown: string; metrics: EodReportMetrics } {
  const collapsed = collapseEodTasks(facts.completed, facts.personName);
  const deliverables = rankEodCompleted(facts);
  const work = collapsed.filter((item) => item.kind === "work");
  const nonWork = collapsed.filter((item) => item.kind !== "work");
  const carried = collapseEodTasks(facts.carried, facts.personName);
  const carriedWork = carried.filter((item) => item.kind === "work");
  const progress = eodProgressRecaps(facts);
  const mismatches = eodPlanMismatches(facts);
  const allBlockers = eodBlockers(facts, 200);
  const blockers = allBlockers.slice(0, 5);
  const extraBlockers = allBlockers.slice(5);
  const automation = collapseAutomation([
    ...facts.automation.filter((item) => !item.outside).map((item) => item.title),
  ]);
  const automationOutside = collapseAutomation([
    ...facts.automation.filter((item) => item.outside).map((item) => item.title),
  ]);
  const top = deliverables.slice(0, 8);

  const main: string[] = [
    `# EOD Report: ${facts.personName} — ${formatReportDate(facts.date)}`,
    "",
    `Role profile: ${facts.roleName ?? "Not set"}`,
    `Goal: ${facts.goal.text ?? "No goal was recorded."}`,
    `Goal source: ${humanizeGoalSource(facts.goal.provenance)}`,
    `Session: ${sessionLabel(facts)}`,
    "",
    "## Summary",
    buildEodSummary(facts),
    "",
    "## Completed today",
    ...(top.length ? top.map((item) => taskLine(item, facts.timezone)) : ["- No work deliverables were recorded today."]),
    ...(deliverables.length > top.length ? [`  …and ${deliverables.length - top.length} more in the full record.`] : []),
    ...(progress.length ? ["", "## In progress", ...progress.map(recapLine)] : []),
    ...(blockers.length
      ? [
          "",
          "## Blocked",
          ...blockers.map((blocker) => `- ${blocker}`),
          ...(extraBlockers.length ? [`  …and ${extraBlockers.length} more in the full record.`] : []),
        ]
      : []),
    ...(carriedWork.length ? ["", "## Next", ...carriedWork.map((item) => taskLine(item, facts.timezone))] : []),
    ...(mismatches.length ? ["", "## Plan check", ...mismatches.map((item) => `- ${item.title} — ${item.note}`)] : []),
    "",
    "## Evidence",
    `- ${deliverables.length} work deliverable${deliverables.length === 1 ? "" : "s"} · ${facts.recaps.length} recorded recap${facts.recaps.length === 1 ? "" : "s"}${facts.media.length ? ` · ${facts.media.length} Loom recording${facts.media.length === 1 ? "" : "s"}` : ""}.`,
    ...(githubEvidenceLine(facts) ? [githubEvidenceLine(facts) as string] : []),
    "",
    "Activity context is descriptive; recorded GitHub activity is a provider fact and still does not prove attendance, productivity, or task completion.",
  ];

  const appendix: string[] = [
    "",
    "## Full record",
    "",
    `### Work completed (${work.length})`,
    ...(work.length ? work.map((item) => taskLine(item, facts.timezone)) : ["- No work deliverables were recorded."]),
    ...(carried.length
      ? ["", `### Carried and deferred (${carried.length})`, ...carried.map((item) => taskLine(item, facts.timezone))]
      : []),
    ...(automation.line || automationOutside.line
      ? [
          "",
          "### Routine runs",
          ...(automation.line ? [automation.line] : []),
          ...(automationOutside.line ? [`${automationOutside.line}${facts.automationOutsideLabel ?? ""}`] : []),
        ]
      : []),
    ...(extraBlockers.length
      ? [
          `### More blockers (${extraBlockers.length})`,
          ...extraBlockers.map((blocker) => `- ${blocker}`),
          "",
        ]
      : []),
    ...(nonWork.length
      ? [
          `### Other tasks (${nonWork.length})`,
          ...nonWork.map((item) => `${taskLine(item, facts.timezone, false)} — ${kindLabel(item.kind)}`),
          "",
        ]
      : []),
    ...(facts.recaps.length
      ? [
          `### Activity context (${facts.recaps.length})`,
          ...facts.recaps.flatMap((recap) => [
            recapLine(recap),
            recap.detail ? `  ${fullText(recap.detail)}` : "",
          ]).filter(Boolean),
          "",
        ]
      : []),
    ...(facts.hourly.length
      ? [
          `### Hourly activity (${facts.hourly.length})`,
          ...facts.hourly.map((hour) => `- ${hour.label}: ${fullText(hour.summary)}`),
          "",
        ]
      : []),
    ...(facts.evidence.length
      ? [
          `### Output evidence (${facts.evidence.length})`,
          ...facts.evidence.map((item) => [
            item.title,
            evidenceSourceLabel(item.source),
            item.url,
            item.summary ? fullText(item.summary) : "",
          ].filter(Boolean).join(" — ")),
          "",
        ]
      : []),
    ...(facts.media.length
      ? [
          `### Recorded Loom updates (${facts.media.length})`,
          ...facts.media.map(mediaLine),
          "",
        ]
      : []),
  ];

  const markdown = [...main, ...appendix].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return {
    markdown,
    metrics: {
      completed: facts.completed.length,
      deliverables: deliverables.length,
      automation: automation.count + automationOutside.count,
      progressed: facts.recaps.length,
      deferred: carried.length,
      carried: carried.length,
      unplanned: facts.evidence.length,
    },
  };
}

function kindLabel(kind: EodTaskKind): string {
  return kind === "administrative" ? "Administrative record" : kind === "test" ? "Test or scratch task" : "Personal task";
}

function sessionLabel(facts: EodReportFacts): string {
  const start = formatLocalTime(facts.session.clockedInAt, facts.timezone);
  const end = formatLocalTime(facts.session.clockedOutAt, facts.timezone);
  if (start && end) return `${start} – ${end}`;
  if (start) return `${start} – still open`;
  return "No recorded session";
}

/** Exposed for the report page: the brief's section names in display order. */
export const EOD_BRIEF_SECTIONS = ["Summary", "Completed today", "In progress", "Blocked", "Next", "Plan check", "Evidence"] as const;
