/* Structured reading of the deterministic EOD markdown. One parser serves the
 * employee pages and the administration review so the same document cannot
 * render two different ways. */

export type EodSectionKey = "summary" | "completed" | "progress" | "blocked" | "next" | "plan" | "evidence" | "other";

export interface EodMetaLine {
  label: string;
  value: string;
}

export interface EodSectionLine {
  text: string;
  kind: "bullet" | "note";
}

export interface EodSection {
  heading: string;
  key: EodSectionKey;
  level: 2 | 3;
  appendix: boolean;
  lines: EodSectionLine[];
}

export interface EodDocument {
  title: string | null;
  meta: EodMetaLine[];
  summary: EodSection | null;
  sections: EodSection[];
  appendix: EodSection[];
  closing: string | null;
}

const META_PATTERN = /^([A-Za-z][A-Za-z ]{1,40}):\s*(.*)$/;
const CLOSING_PREFIX = "Activity context is descriptive";
const SUMMARY_HEADING = /^summary$/i;

function sectionKey(heading: string): EodSectionKey {
  if (SUMMARY_HEADING.test(heading)) return "summary";
  if (/^(completed (today|work)|work completed)$/i.test(heading)) return "completed";
  if (/^in progress$/i.test(heading)) return "progress";
  if (/^blocked$/i.test(heading)) return "blocked";
  if (/^(next|carried( and deferred)?)$/i.test(heading)) return "next";
  if (/^plan (check|reconciliation)$/i.test(heading)) return "plan";
  if (/^evidence$/i.test(heading)) return "evidence";
  return "other";
}

export function parseEodMarkdown(markdown: string): EodDocument {
  const document: EodDocument = { title: null, meta: [], summary: null, sections: [], appendix: [], closing: null };
  const lines = String(markdown ?? "").split(/\r?\n/);
  let current: EodSection | null = null;
  let appendix = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("# ")) {
      document.title = line.slice(2).trim();
      continue;
    }
    if (line.startsWith("### ")) {
      const heading = line.slice(4).trim();
      current = { heading, key: sectionKey(heading.replace(/\s*\(\d+\)\s*$/, "")), level: 3, appendix, lines: [] };
      (appendix ? document.appendix : document.sections).push(current);
      continue;
    }
    if (line.startsWith("## ")) {
      const heading = line.slice(3).trim();
      if (/^full record$/i.test(heading)) {
        current = null;
        appendix = true;
        continue;
      }
      current = { heading, key: sectionKey(heading.replace(/\s*\(\d+\)\s*$/, "")), level: 2, appendix: false, lines: [] };
      document.sections.push(current);
      continue;
    }
    if (line.startsWith(CLOSING_PREFIX)) {
      document.closing = line;
      continue;
    }
    const metaMatch = META_PATTERN.exec(line);
    if (metaMatch && !current && !appendix) {
      document.meta.push({ label: metaMatch[1], value: metaMatch[2] || "—" });
      continue;
    }
    if (!current) continue;
    const text = line.startsWith("- ") ? line.slice(2).trim() : line;
    const emptyNote = /^(No |Nothing |None\.?$)/.test(text);
    // A continuation line is indented in the source. It belongs to the recap
    // or row above it and must not read as another fact.
    const continuation = /^\s{2,}/.test(rawLine);
    current.lines.push({ text, kind: emptyNote || continuation ? "note" : "bullet" });
  }
  document.summary = document.sections.find((section) => section.key === "summary") ?? null;
  return document;
}

export interface EodInlineSegment {
  text: string;
  href: string | null;
}

/** Splits a row into plain text and links. The report is a document, not
 * trusted HTML; only http(s) links become anchors. */
export function parseEodInline(value: string): EodInlineSegment[] {
  const text = String(value ?? "");
  const segments: EodInlineSegment[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: text.slice(last, index), href: null });
    if (match[1] && match[2]) segments.push({ text: match[1], href: match[2] });
    else {
      const rawUrl = match[3] ?? "";
      const bare = rawUrl.replace(/[.,;:]+$/, "");
      segments.push({ text: bare, href: bare });
      const trailing = rawUrl.slice(bare.length);
      if (trailing) segments.push({ text: trailing, href: null });
    }
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), href: null });
  return segments.length ? segments : [{ text, href: null }];
}

export type EodSectionIconKind =
  | "completed"
  | "progress"
  | "blocked"
  | "next"
  | "plan"
  | "evidence"
  | "updates"
  | "carried"
  | "automation"
  | "other"
  | "activity"
  | "hourly"
  | "output"
  | "loom";

/** One semantic icon per section label. The renderers map these kinds to
 * their own icon family; the parser stays pure. */
export function eodSectionIconKind(heading: string): EodSectionIconKind | null {
  const key = heading.replace(/\s*\(\d+\)\s*$/, "").trim().toLowerCase();
  const icons: Record<string, EodSectionIconKind> = {
    "completed today": "completed",
    "work completed": "completed",
    "in progress": "progress",
    "blocked": "blocked",
    "more blockers": "blocked",
    "next": "next",
    "plan check": "plan",
    "more plan discrepancies": "plan",
    "evidence": "evidence",
    "recorded updates": "updates",
    "carried and deferred": "carried",
    "routine runs": "automation",
    "other tasks": "other",
    "activity context": "activity",
    "hourly activity": "hourly",
    "output evidence": "output",
    "recorded loom updates": "loom",
  };
  return icons[key] ?? null;
}

export interface EodTaskRowParts {
  title: string;
  project: string | null;
  time: string | null;
  outside: string | null;
  count: number;
}

/** The builder writes `Title — Project · 3:30 PM (outside shift)`. The page
 * reads those tracks back so the title, project, and time each get the right
 * typographic weight instead of one long paragraph. */
export function splitEodTaskRow(value: string): EodTaskRowParts {
  let text = String(value ?? "").trim();
  // The current builder wraps project, time, and window metadata in a trailing
  // bracket, so a title that itself contains `—` or `·` stays intact.
  const bracket = /\s+\[([^\]]+)\]\s*$/.exec(text);
  if (bracket) {
    const meta = bracket[1]!;
    text = text.slice(0, bracket.index).trim();
    let time: string | null = null;
    let outside: string | null = null;
    const projectParts: string[] = [];
    for (const track of meta.split(" · ").map((part) => part.trim()).filter(Boolean)) {
      if (/^\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(track)) { time = track; continue; }
      const windowMatch = /^\((outside (?:the )?(?:shift|workday))\)$/i.exec(track);
      if (windowMatch) { outside = windowMatch[1]!; continue; }
      projectParts.push(track);
    }
    let count = 1;
    const countMatch = /^(.*?)\s+×(\d+)$/.exec(text);
    if (countMatch) {
      text = countMatch[1]!.trim();
      count = Number(countMatch[2]) || 1;
    }
    return { title: text, project: projectParts.join(" · ") || null, time, outside, count };
  }
  let outside: string | null = null;
  const outsideMatch = /\s+\((outside (?:the )?(?:shift|workday))\)\s*$/i.exec(text);
  if (outsideMatch) {
    outside = outsideMatch[1];
    // The builder writes `Project · 3:30 PM · (outside shift)`. Remove the
    // trailing separator with the label, or the time parser sees an empty
    // final track and leaves the time inside the project.
    text = text.slice(0, outsideMatch.index).trim().replace(/\s*·\s*$/, "").trim();
  }
  let time: string | null = null;
  const metaIndex = text.lastIndexOf(" · ");
  if (metaIndex > 0) {
    const candidate = text.slice(metaIndex + 3).trim();
    if (/^\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(candidate)) {
      time = candidate;
      text = text.slice(0, metaIndex).trim();
    }
  }
  let project: string | null = null;
  const projectIndex = text.lastIndexOf(" — ");
  if (projectIndex > 0) {
    const candidate = text.slice(projectIndex + 3).trim();
    // A project-free row is `Title — 3:30 PM`; the track after the dash is the
    // time, not a project.
    if (!time && /^\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(candidate)) time = candidate;
    else project = candidate || null;
    text = text.slice(0, projectIndex).trim();
  }
  let count = 1;
  const countMatch = /^(.*?)\s+×(\d+)$/.exec(text);
  if (countMatch) {
    text = countMatch[1].trim();
    count = Number(countMatch[2]) || 1;
  }
  return { title: text, project, time, outside, count };
}

export interface EodNoteRowParts {
  title: string;
  note: string | null;
}

export function splitEodNoteRow(value: string): EodNoteRowParts {
  const text = String(value ?? "").trim();
  const index = text.indexOf(" — ");
  return index > 0
    ? { title: text.slice(0, index).trim(), note: text.slice(index + 3).trim() || null }
    : { title: text, note: null };
}

export interface EodRecapRowParts {
  label: string;
  provenance: string;
  headline: string;
}

export function splitEodRecapRow(value: string): EodRecapRowParts | null {
  const match = /^(.+?)\s+—\s+(Confirmed|Updated by you|Inferred):\s*(.+)$/i.exec(String(value ?? "").trim());
  return match ? { label: match[1]!, provenance: match[2]!, headline: match[3]! } : null;
}
