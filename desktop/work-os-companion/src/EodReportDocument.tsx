import { parseEodInline, parseEodMarkdown, splitEodNoteRow, splitEodRecapRow, splitEodTaskRow, type EodDocument, type EodSection, type EodSectionLine } from "../../../src/modules/work-os/eod-document";

function Inline({ text }: { text: string }) {
  return <>{parseEodInline(text).map((segment, index) => segment.href
    ? <a key={`${segment.href}:${index}`} href={segment.href} target="_blank" rel="noreferrer">{segment.text}</a>
    : <span key={`text:${index}`}>{segment.text}</span>)}</>;
}

function metaValue(document: EodDocument, label: string): string {
  return document.meta.find((item) => item.label.toLowerCase() === label)?.value ?? "";
}

function goalSourceLabel(value: string): string {
  const key = value.trim().toLowerCase();
  if (key === "employee") return "Employee goal";
  if (key === "suggested") return "Suggested goal";
  if (key === "ai_draft") return "AI draft";
  if (key === "accepted_suggestion") return "Accepted suggestion";
  return "";
}

function TaskRow({ line, showProject = true }: { line: EodSectionLine; showProject?: boolean }) {
  const parts = splitEodTaskRow(line.text);
  return (
    <li className="eod-doc-row">
      <span className="eod-doc-main">
        <span className="eod-doc-title">
          <Inline text={parts.title} />
          {parts.count > 1 ? <span className="eod-doc-count">×{parts.count}</span> : null}
        </span>
        {showProject && parts.project ? <span className="eod-doc-project">{parts.project}</span> : null}
      </span>
      <span className="eod-doc-meta">
        {parts.time ? <time className="eod-doc-time">{parts.time}</time> : null}
        {parts.outside ? <span className="eod-doc-outside">{parts.outside}</span> : null}
      </span>
    </li>
  );
}

function RecapRow({ line }: { line: EodSectionLine }) {
  const parts = splitEodRecapRow(line.text);
  if (!parts) return <NoteRow line={line} />;
  return (
    <li className="eod-doc-row">
      <span className="eod-doc-main">
        <span className="eod-doc-title"><Inline text={parts.headline} /></span>
        <span className="eod-doc-project">{parts.provenance}</span>
      </span>
      <time className="eod-doc-time">{parts.label}</time>
    </li>
  );
}

function NoteRow({ line }: { line: EodSectionLine }) {
  const parts = splitEodNoteRow(line.text);
  return (
    <li className="eod-doc-row">
      <span className="eod-doc-main">
        <span className="eod-doc-title"><Inline text={parts.title} /></span>
        {parts.note ? <span className="eod-doc-project"><Inline text={parts.note} /></span> : null}
      </span>
    </li>
  );
}

function EvidenceRow({ line }: { line: EodSectionLine }) {
  return <li className="eod-doc-row"><span className="eod-doc-evidence"><Inline text={line.text} /></span></li>;
}

/** Completed work groups by project so the project is stated once for a run
 * of rows instead of repeated under every title. */
function GroupedTaskRows({ lines }: { lines: EodSectionLine[] }) {
  const groups = new Map<string, EodSectionLine[]>();
  const notes = lines.filter((line) => line.kind === "note");
  for (const line of lines) {
    if (line.kind !== "bullet") continue;
    const project = splitEodTaskRow(line.text).project ?? "Other work";
    const rows = groups.get(project) ?? [];
    rows.push(line);
    groups.set(project, rows);
  }
  if (!groups.size) return null;
  if (groups.size === 1 && groups.has("Other work")) {
    return (
      <ul className="eod-doc-rows">
        {[...groups.get("Other work")!].map((line, index) => <TaskRow key={index} line={line} showProject={false} />)}
        {notes.map((line, index) => <li key={`note:${index}`} className="eod-doc-note"><Inline text={line.text} /></li>)}
      </ul>
    );
  }
  return (
    <div className="eod-doc-groups">
      {[...groups.entries()].map(([project, rows]) => (
        <section key={project} className="eod-doc-group" aria-label={project}>
          <h4 className="eod-doc-group-label">{project}<span>{rows.length}</span></h4>
          <ul className="eod-doc-rows">
            {rows.map((line, index) => <TaskRow key={index} line={line} showProject={false} />)}
          </ul>
        </section>
      ))}
      {notes.length ? <div className="eod-doc-group-notes">{notes.map((line, index) => <p key={index}><Inline text={line.text} /></p>)}</div> : null}
    </div>
  );
}

function SectionRows({ section }: { section: EodSection }) {
  const bullets = section.lines.filter((line) => line.kind === "bullet");
  if (!bullets.length) return null;
  if (section.key === "completed") return <GroupedTaskRows lines={section.lines} />;
  return (
    <ul className="eod-doc-rows">
      {section.lines.map((line, index) => {
        if (line.kind === "note") return <li key={index} className="eod-doc-note"><Inline text={line.text} /></li>;
        if (section.key === "next") return <TaskRow key={index} line={line} />;
        if (section.key === "progress") return <RecapRow key={index} line={line} />;
        if (section.key === "evidence") return <EvidenceRow key={index} line={line} />;
        return <NoteRow key={index} line={line} />;
      })}
    </ul>
  );
}

function Section({ section }: { section: EodSection }) {
  const count = section.lines.filter((line) => line.kind === "bullet").length;
  if (!count) return null;
  return (
    <section className="eod-doc-section" aria-label={section.heading}>
      <div className="eod-doc-label">
        <h3>{section.heading.replace(/\s*\(\d+\)\s*$/, "")}</h3>
        {section.key !== "evidence" ? <span>{count}</span> : null}
      </div>
      <div className="eod-doc-body"><SectionRows section={section} /></div>
    </section>
  );
}

export default function EodReportDocument({ markdown }: { markdown: string }) {
  const document = parseEodMarkdown(markdown);
  const summary = document.summary?.lines.find((line) => line.text)?.text ?? "";
  const sections = document.sections.filter((section) => section.key !== "summary");
  const appendixCount = document.appendix.reduce((count, section) => count + section.lines.filter((line) => line.kind === "bullet").length, 0);
  const roleValue = metaValue(document, "role profile");
  const goalValue = metaValue(document, "goal");
  const role = roleValue && !/^not set$/i.test(roleValue) ? roleValue : "";
  const goal = goalValue && !/^no goal was recorded\.?$/i.test(goalValue) ? goalValue : "";
  const session = metaValue(document, "session");
  const source = goalSourceLabel(metaValue(document, "goal source"));

  if (!summary && !sections.length) return <p className="eod-doc-empty">Nothing to preview yet.</p>;

  return (
    <article className="eod-document" aria-label="End-of-day report">
      {role || session || goal ? (
        <div className="eod-doc-dateline">
          {role ? <span className="eod-doc-dateline-role">{role}</span> : null}
          {session ? <span className="eod-doc-dateline-session">{session}</span> : null}
          {goal ? (
            <span className="eod-doc-dateline-goal">
              <span className="eod-doc-dateline-label">Goal</span>
              <span>{goal}</span>
              {source ? <em>{source}</em> : null}
            </span>
          ) : null}
        </div>
      ) : null}
      {summary ? <p className="eod-doc-summary"><Inline text={summary} /></p> : null}
      <div className="eod-doc-sections">
        {sections.map((section) => <Section key={`${section.level}:${section.heading}`} section={section} />)}
      </div>
      {document.closing ? <p className="eod-doc-closing"><Inline text={document.closing} /></p> : null}
      {document.appendix.length ? (
        <details className="eod-doc-appendix">
          <summary>
            <span>Full record</span>
            <span>{appendixCount} entries</span>
          </summary>
          <div className="eod-doc-appendix-body">
            {document.appendix.map((section) => <Section key={`${section.level}:${section.heading}`} section={section} />)}
          </div>
        </details>
      ) : null}
    </article>
  );
}
