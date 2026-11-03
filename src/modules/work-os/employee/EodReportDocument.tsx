"use client";

import { parseEodInline, parseEodMarkdown, splitEodNoteRow, splitEodRecapRow, splitEodTaskRow, type EodSection, type EodSectionLine } from "@/modules/work-os/eod-document";
import styles from "./EodReportDocument.module.css";

function Inline({ text }: { text: string }) {
  return <>{parseEodInline(text).map((segment, index) => segment.href
    ? <a key={`${segment.href}:${index}`} href={segment.href} target="_blank" rel="noreferrer">{segment.text}</a>
    : <span key={`text:${index}`}>{segment.text}</span>)}</>;
}

function TaskRow({ line }: { line: EodSectionLine }) {
  const parts = splitEodTaskRow(line.text);
  return (
    <li className={styles.row}>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>
          <Inline text={parts.title} />
          {parts.count > 1 ? <span className={styles.count}>×{parts.count}</span> : null}
        </span>
        {parts.project ? <span className={styles.rowProject}>{parts.project}</span> : null}
      </span>
      <span className={styles.rowMeta}>
        {parts.time ? <time className={styles.rowTime}>{parts.time}</time> : null}
        {parts.outside ? <span className={styles.rowOutside}>{parts.outside}</span> : null}
      </span>
    </li>
  );
}

function RecapRow({ line }: { line: EodSectionLine }) {
  const parts = splitEodRecapRow(line.text);
  if (!parts) return <NoteRow line={line} />;
  return (
    <li className={styles.row}>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}><Inline text={parts.headline} /></span>
        <span className={styles.rowProject}>{parts.provenance}</span>
      </span>
      <time className={styles.rowTime}>{parts.label}</time>
    </li>
  );
}

function NoteRow({ line }: { line: EodSectionLine }) {
  const parts = splitEodNoteRow(line.text);
  return (
    <li className={styles.row}>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}><Inline text={parts.title} /></span>
        {parts.note ? <span className={styles.rowNote}><Inline text={parts.note} /></span> : null}
      </span>
    </li>
  );
}

function EvidenceRow({ line }: { line: EodSectionLine }) {
  return <li className={styles.row}><span className={styles.evidence}><Inline text={line.text} /></span></li>;
}

function SectionRows({ section }: { section: EodSection }) {
  const bullets = section.lines.filter((line) => line.kind === "bullet");
  if (!bullets.length) return null;
  return (
    <ul className={styles.rows}>
      {section.lines.map((line, index) => {
        if (line.kind === "note") return <li key={index} className={styles.noteRow}><Inline text={line.text} /></li>;
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
  const label = section.heading.replace(/\s*\(\d+\)\s*$/, "");
  return (
    <section className={styles.section} aria-labelledby={`eod-${section.heading.replace(/\W+/g, "-")}`}>
      <div className={styles.sectionLabel}>
        <h3 id={`eod-${section.heading.replace(/\W+/g, "-")}`}>{label}</h3>
        {section.key !== "evidence" ? <span className={styles.sectionCount}>{count}</span> : null}
      </div>
      <div className={styles.sectionBody}>
        <SectionRows section={section} />
      </div>
    </section>
  );
}

export default function EodReportDocument({
  markdown,
  editing = false,
  locked = false,
  onChange,
}: {
  markdown: string;
  editing?: boolean;
  locked?: boolean;
  onChange?: (value: string) => void;
}) {
  if (editing) {
    return (
      <div className={styles.editorWrap}>
        <p className={styles.editorNote}>
          Editing the report source. Keep the headings so the brief and the full record stay intact.
        </p>
        <textarea
          className={styles.editor}
          value={markdown}
          onChange={(event) => onChange?.(event.target.value)}
          rows={24}
          spellCheck={false}
          disabled={locked}
          aria-label="EOD report source"
        />
      </div>
    );
  }

  const document = parseEodMarkdown(markdown);
  const summary = document.summary?.lines.find((line) => line.text)?.text ?? "";
  const sections = document.sections.filter((section) => section.key !== "summary");
  const appendixCount = document.appendix.reduce((count, section) => count + section.lines.filter((line) => line.kind === "bullet").length, 0);

  if (!summary && !sections.length) {
    return <p className={styles.empty}>Nothing to preview yet. Draft the report or switch to the source editor to write it.</p>;
  }

  return (
    <article className={styles.document} aria-label="End-of-day report">
      {document.meta.length ? (
        <dl className={styles.meta}>
          {document.meta.map((item) => (
            <div key={item.label} className={item.label === "Goal" ? styles.metaWide : undefined}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {summary ? <p className={styles.summary}><Inline text={summary} /></p> : null}
      <div className={styles.sections}>
        {sections.map((section) => <Section key={`${section.level}:${section.heading}`} section={section} />)}
      </div>
      {document.closing ? <p className={styles.closing}><Inline text={document.closing} /></p> : null}
      {document.appendix.length ? (
        <details className={styles.appendix}>
          <summary>
            <span>Full record</span>
            <span className={styles.appendixCount}>{appendixCount} entries</span>
          </summary>
          <div className={styles.appendixBody}>
            {document.appendix.map((section) => <Section key={`${section.level}:${section.heading}`} section={section} />)}
          </div>
        </details>
      ) : null}
    </article>
  );
}
