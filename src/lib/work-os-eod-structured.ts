/* Server-side projection from the deterministic day record into the structured
 * EOD composition.
 *
 * Suggestions are extracted from the day's own facts: completed work, the
 * reviewed activity recaps, and the tasks the record already marks as carried
 * or planned. They are suggestions, not pre-filled claims. The evidence
 * snapshot is grouped by source so the composer and the admin review can show
 * the same immutable record.
 */

import {
  buildEodReportMarkdown,
  buildEodSummary,
  collapseEodTasks,
  rankEodCompleted,
  type EodReportFacts,
} from "@/lib/work-os-eod-report";
import { cleanEodText, type EodEvidenceGroup, type EodEvidenceItem, type EodStructuredReport, type EodSuggestions } from "@/modules/work-os/eod-structured";
export { assembleEodSummary } from "@/modules/work-os/eod-structured";
import { clipText, formatLocalTime } from "@/lib/work-os-eod-facts";

function unique(values: Array<string | null | undefined>, limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = cleanEodText(value, 240);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function recapProvenance(value: string): string {
  if (value === "confirmed") return "Employee confirmed";
  if (value === "amended") return "Employee amended";
  return "AI-inferred, not reviewed";
}

function taskKindLabel(kind: string): string | null {
  if (kind === "personal") return "Personal task";
  if (kind === "test") return "Test or scratch task";
  if (kind === "administrative") return "Administrative record";
  return null;
}

function taskMeta(item: ReturnType<typeof collapseEodTasks>[number], facts: EodReportFacts): string | null {
  return [
    item.project,
    formatLocalTime(item.at, facts.timezone),
    item.exact ? "recorded time" : item.at ? "observed time" : null,
    item.outsideLabel,
    taskKindLabel(item.kind),
  ].filter(Boolean).join(" · ") || null;
}

/** What the composer offers before the employee writes a single line. */
export function buildEodSuggestions(facts: EodReportFacts): EodSuggestions {
  const completedTasks = rankEodCompleted(facts).map((item) => item.title);
  const completed = unique([
    ...completedTasks,
    ...facts.evidence.map((item) => item.title),
  ], 5);

  // In progress comes from the employee-reviewed recaps, not from the plan:
  // a selected plan item is a commitment, not evidence that work started.
  const inProgress = unique(
    facts.recaps.map((recap) => recap.headline || clipText(recap.detail, 180)),
    5,
  );

  const taken = new Set([...completed, ...inProgress].map((text) => text.toLowerCase()));
  const next = unique([
    ...collapseEodTasks(facts.carried, facts.personName).map((item) => item.title),
    ...facts.planItems
      .filter((item) => item.disposition === "selected" || item.disposition === "deferred")
      .map((item) => item.title),
  ].filter((title) => !taken.has(title.toLowerCase())), 5);

  return { completed, inProgress, next };
}

/** The report's immutable evidence snapshot, grouped by source. The structured
 * view never invents a source: when the day has no records for one, it simply
 * does not appear. */
export function buildEodEvidenceGroups(facts: EodReportFacts): EodEvidenceGroup[] {
  const groups: EodEvidenceGroup[] = [];

  const completed = collapseEodTasks(facts.completed, facts.personName);
  const carried = collapseEodTasks(facts.carried, facts.personName);
  const taskItems: EodEvidenceItem[] = [
    ...completed.map((item, index) => ({
      id: `completed-${item.ids[0] ?? index}`,
      title: item.count > 1 ? `${item.title} ×${item.count}` : item.title,
      summary: null,
      meta: taskMeta(item, facts),
      url: null,
      at: item.at,
      kind: "completed",
    })),
    ...carried.map((item, index) => ({
      id: `carried-${item.ids[0] ?? index}`,
      title: item.title,
      summary: null,
      meta: [item.project, "carried forward", taskKindLabel(item.kind)].filter(Boolean).join(" · ") || null,
      url: null,
      at: item.at,
      kind: "carried",
    })),
  ];
  if (taskItems.length) groups.push({ source: "tasks", label: "Tasks", items: taskItems.slice(0, 24) });

  const recapItems: EodEvidenceItem[] = facts.recaps.map((recap, index) => ({
    id: `recap-${index}`,
    title: recap.headline || "Recorded activity interval",
    summary: recap.detail || null,
    meta: `${recap.label} · ${recapProvenance(recap.provenance)}`,
    url: null,
    at: recap.endIso,
    kind: "recap",
  }));
  const worktivityItems = recapItems.length
    ? recapItems
    : facts.hourly.map((hour, index) => ({
        id: `hour-${index}`,
        title: hour.label,
        summary: hour.summary,
        meta: "Hourly activity context",
        url: null,
        at: null,
        kind: "hour",
      }));
  if (worktivityItems.length) {
    groups.push({ source: "worktivity", label: "Worktivity", items: worktivityItems.slice(0, 24) });
  }

  if (facts.github) {
    const items: EodEvidenceItem[] = (facts.github.items ?? []).map((item, index) => ({
      id: `github-${index}`,
      title: item.description,
      summary: null,
      meta: [
        item.relation === "performed" ? "Performed by you" : "Triggered by your work",
        item.repository,
        formatLocalTime(item.at, facts.timezone),
      ].filter(Boolean).join(" · "),
      url: item.url,
      at: item.at,
      kind: item.relation,
    }));
    const performed = facts.github.performed;
    const triggered = facts.github.triggered;
    const performedSummary = [
      facts.github.commits ? `${facts.github.commits} commit${facts.github.commits === 1 ? "" : "s"} pushed` : null,
      performed.pullRequest ? `${performed.pullRequest} pull request${performed.pullRequest === 1 ? "" : "s"}` : null,
      performed.review ? `${performed.review} review${performed.review === 1 ? "" : "s"}` : null,
      performed.issue ? `${performed.issue} issue${performed.issue === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(" · ");
    const triggeredSummary = [
      triggered.workflowRun ? `${triggered.workflowRun} workflow run${triggered.workflowRun === 1 ? "" : "s"} triggered` : null,
      triggered.deployment ? `${triggered.deployment} deployment${triggered.deployment === 1 ? "" : "s"} triggered` : null,
      triggered.pullRequest ? `${triggered.pullRequest} pull request${triggered.pullRequest === 1 ? "" : "s"} merged` : null,
      triggered.review ? `${triggered.review} review${triggered.review === 1 ? "" : "s"} on your work` : null,
      triggered.issue ? `${triggered.issue} issue${triggered.issue === 1 ? "" : "s"} on your work` : null,
    ].filter(Boolean).join(" · ");
    if (!items.length && (performedSummary || triggeredSummary)) {
      if (performedSummary) {
        items.push({
          id: "github-summary",
          title: performedSummary,
          summary: facts.github.pullRequests.length ? facts.github.pullRequests.join(", ") : null,
          meta: "Performed by you · provider-recorded",
          url: null,
          at: null,
          kind: "summary",
        });
      }
      if (triggeredSummary) {
        items.push({
          id: "github-triggered-summary",
          title: triggeredSummary,
          summary: null,
          meta: "Triggered by your work · provider-recorded",
          url: null,
          at: null,
          kind: "triggered-summary",
        });
      }
    }
    if (items.length) groups.push({ source: "github", label: "GitHub", items: items.slice(0, 24) });
  }

  if (facts.media.length) {
    groups.push({
      source: "loom",
      label: "Loom",
      items: facts.media.map((item, index) => ({
        id: `loom-${index}`,
        title: item.title,
        summary: item.digest,
        meta: item.durationSeconds ? `Recording · ${Math.floor(item.durationSeconds / 60)}:${String(Math.round(item.durationSeconds % 60)).padStart(2, "0")}` : "Loom recording",
        url: item.url,
        at: null,
        kind: "recording",
      })),
    });
  }

  const otherEvidence = new Map<string, EodEvidenceItem[]>();
  for (const item of facts.evidence) {
    const source = cleanEodText(item.source, 48).toLowerCase() || "other";
    if (["worktivity", "loom", "github"].includes(source)) continue;
    const list = otherEvidence.get(source) ?? [];
    list.push({
      id: `evidence-${source}-${list.length}`,
      title: item.title,
      summary: item.summary || null,
      meta: `${source} · output evidence`,
      url: item.url,
      at: null,
      kind: "evidence",
    });
    otherEvidence.set(source, list);
  }
  for (const [source, items] of otherEvidence) {
    groups.push({ source, label: source === "google_docs" ? "Docs" : source, items: items.slice(0, 24) });
  }

  if (facts.ghl) {
    const performed = Object.entries(facts.ghl.performed).filter(([, count]) => count > 0);
    if (performed.length) {
      groups.push({
        source: "ghl",
        label: "GoHighLevel",
        items: [{
          id: "ghl-summary",
          title: performed.map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`).join(" · "),
          summary: facts.ghl.context ? `${facts.ghl.context} shared or contextual records` : null,
          meta: "Provider-recorded CRM activity",
          url: null,
          at: null,
          kind: "summary",
        }],
      });
    }
  }

  return groups.slice(0, 10);
}

function structuredLines(lines: string[]): string[] {
  return lines.length ? lines.map((line) => `- ${line}`) : ["- No line was written."];
}

/** The employee's words replace the brief's narrative sections. The full
 * record appendix and the recorded evidence line stay deterministic. */
export function composeStructuredEodMarkdown(
  facts: EodReportFacts,
  structured: EodStructuredReport,
): { markdown: string; metrics: ReturnType<typeof buildEodReportMarkdown>["metrics"] } {
  const base = buildEodReportMarkdown(facts);
  const hasComposition = Boolean(
    structured.summary
    || structured.completed.length
    || structured.inProgress.length
    || structured.next.length,
  );
  if (!hasComposition) return base;

  const fullRecordAt = base.markdown.indexOf("\n## Full record");
  const brief = fullRecordAt >= 0 ? base.markdown.slice(0, fullRecordAt) : base.markdown;
  const appendix = fullRecordAt >= 0 ? base.markdown.slice(fullRecordAt) : "";
  const summaryAt = brief.indexOf("## Summary");
  const header = summaryAt >= 0 ? brief.slice(0, summaryAt).trimEnd() : "";
  const evidenceAt = brief.indexOf("## Evidence");
  const evidence = evidenceAt >= 0 ? brief.slice(evidenceAt).trim() : "";
  const summary = structured.summary || buildEodSummary(facts);

  const lines = [
    ...(header ? [header, ""] : []),
    "## Summary",
    summary,
    "",
    "## Completed today",
    ...structuredLines(structured.completed),
    "",
    "## In progress",
    ...structuredLines(structured.inProgress),
    "",
    "## Next",
    ...structuredLines(structured.next),
    ...(evidence ? ["", evidence] : []),
    ...(structured.loomUrl ? ["", `- Loom recording attached by the employee: ${structured.loomUrl}`] : []),
    ...(appendix ? [appendix] : []),
  ].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();

  return { markdown: lines, metrics: base.metrics };
}


interface BriefSection {
  heading: string;
  body: string;
}

function splitBrief(markdown: string): { header: string; sections: BriefSection[] } {
  const header: string[] = [];
  const sections: BriefSection[] = [];
  let current: BriefSection | null = null;
  for (const line of String(markdown ?? "").split("\n")) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { heading: line.slice(3).trim(), body: "" };
      continue;
    }
    if (current) current.body += `${current.body ? "\n" : ""}${line}`;
    else header.push(line);
  }
  if (current) sections.push(current);
  return {
    header: header.join("\n").trimEnd(),
    sections: sections.map((section) => ({
      heading: section.heading,
      body: section.body.replace(/^\n+|\n+$/g, ""),
    })),
  };
}

/** Keeps the report's stored markdown in step with a structured save without
 * rebuilding the day's facts. Only the four employee-owned sections change;
 * the deterministic Evidence, Plan check and Full record sections stay. This
 * is what the companion, agent reads and version history see while the web
 * composer is still editing. */
export function applyStructuredBrief(markdown: string, structured: EodStructuredReport): string {
  const fullRecordAt = String(markdown).indexOf("\n## Full record");
  const brief = fullRecordAt >= 0 ? markdown.slice(0, fullRecordAt) : markdown;
  const appendix = fullRecordAt >= 0 ? markdown.slice(fullRecordAt) : "";
  const parsed = splitBrief(brief);
  const bullets = (lines: string[]) => lines.length ? lines.map((line) => `- ${line}`).join("\n") : null;
  const replaced = new Set(["summary", "completed today", "in progress", "next"]);
  const preserved = parsed.sections.filter((section) => !replaced.has(section.heading.toLowerCase()));
  const parts: string[] = [];
  if (parsed.header) parts.push(parsed.header);
  // This function only runs on an explicit employee save. An empty field is a
  // clear, never a reason to restore the earlier prepared claim.
  parts.push("## Summary", structured.summary || "No summary was written.");
  parts.push("## Completed today", bullets(structured.completed) || "No work deliverables were recorded today.");
  parts.push("## In progress", bullets(structured.inProgress) || "No line was written.");
  parts.push("## Next", bullets(structured.next) || "No line was written.");
  for (const section of preserved) {
    if (section.heading.toLowerCase() === "evidence") {
      const body = section.body
        .replace(/^- Loom recording attached by the employee:.*$/gim, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      parts.push(`## ${section.heading}`, [body, structured.loomUrl ? `- Loom recording attached by the employee: ${structured.loomUrl}` : ""].filter(Boolean).join("\n"));
    } else {
      parts.push(`## ${section.heading}`, section.body);
    }
  }
  return `${parts.filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}${appendix}`;
}
