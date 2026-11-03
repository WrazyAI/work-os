import { parseEodInline, parseEodMarkdown, splitEodNoteRow, splitEodRecapRow, splitEodTaskRow, type EodSection, type EodSectionLine } from "../../../src/modules/work-os/eod-document";

function Inline({ text }: { text: string }) {
  return <>{parseEodInline(text).map((segment, index) => segment.href
    ? <a key={`${segment.href}:${index}`} href={segment.href} target="_blank" rel="noreferrer">{segment.text}</a>
    : <span key={`text:${index}`}>{segment.text}</span>)}</>;
}

function TaskRow({ line }: { line: EodSectionLine }) {
  const parts = splitEodTaskRow(line.text);
  return (
    <li className="eod-doc-row">
      <span className="eod-doc-main">
        <span className="eod-doc-title">
          <Inline text={parts.title} />
          {parts.count > 1 ? <span className="eod-doc-count">×{parts.count}</span> : null}
        </span>
        {parts.project ? <span className="eod-doc-project">{parts.project}</span> : null}
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

function SectionRows({ section }: { section: EodSection }) {
  const bullets = section.lines.filter((line) => line.kind === "bullet");
  if (!bullets.length) return null;
  return (
    <ul className="eod-doc-rows">
      {section.lines.map((line, index) => {
        if (line.kind === "note") return <li key={index} className="eod-doc-note"><Inline text={line.text} /></li>;
        if (section.key === "completed" || section.key === "next") return <TaskRow key={index} line={line} />;
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

  if (!summary && !sections.length) return <p className="eod-doc-empty">Nothing to preview yet.</p>;

  return (
    <article className="eod-document" aria-label="End-of-day report">
      {document.meta.length ? (
        <dl className="eod-doc-meta-grid">
          {document.meta.map((item) => (
            <div key={item.label} className={item.label === "Goal" ? "is-wide" : undefined}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
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
