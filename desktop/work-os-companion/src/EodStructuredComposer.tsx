import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Lock, Plus, RotateCw, Trash2, Video } from "lucide-react";
import {
  EOD_MAX_LINE_CHARS,
  EOD_MAX_LINES,
  cleanEodLines,
  createSaveFlight,
  eodCompositionIsComplete,
  eodCompositionSignature,
  eodSummaryIsCurrent,
  eodSummaryMode,
  normalizeLoomShareUrl,
  saveFailureNotice,
  type EodCompositionInput,
  type EodStructuredReport,
} from "./eodStructured";

export type EodStructuredSaveResult = "saved" | "queued";

export type EodStructuredComposerProps = {
  reportId: string;
  structured: EodStructuredReport;
  dayLabel?: string;
  clockedOut?: boolean;
  shiftOpen?: boolean;
  loomEnabled?: boolean;
  summaryStreaming?: boolean;
  screenshots?: ReactNode;
  onOpenDashboard?: () => void;
  onSave: (input: EodCompositionInput) => Promise<EodStructuredSaveResult>;
  onWriteSummary: (
    input: EodCompositionInput,
    onChunk: (text: string) => void,
    signal: AbortSignal,
  ) => Promise<{ source: "otto" | "assembled" }>;
  onSubmit: (input: EodCompositionInput, idempotencyKey: string) => Promise<EodStructuredSaveResult>;
  onRedraft: () => void;
  onDelete?: () => void;
  onReload?: () => void;
};

type FieldKey = "completed" | "inProgress" | "next";
type SaveState = "saved" | "saving" | "queued" | "error";

const FIELD_META: Record<FieldKey, { number: string; title: string; description: string; source: string; placeholder: string }> = {
  completed: {
    number: "01",
    title: "Completed",
    description: "What actually landed today.",
    source: "From today's record",
    placeholder: "Add what landed…",
  },
  inProgress: {
    number: "02",
    title: "In progress",
    description: "What is still moving.",
    source: "From your recap",
    placeholder: "Add what is still moving…",
  },
  next: {
    number: "03",
    title: "Next",
    description: "Where tomorrow starts.",
    source: "From your plan",
    placeholder: "Add where tomorrow starts…",
  },
};
const FIELDS: FieldKey[] = ["completed", "inProgress", "next"];
const SUGGESTIONS_PER_PAGE = 2;
const MAX_LINES = EOD_MAX_LINES;
const SAVE_DEBOUNCE_MS = 700;

function formatAt(value: string | null): string | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function linesFor(value: string[]): string[] {
  return value.length ? value : [""];
}

/** The desktop structured composer. The server owns suggestions and evidence;
 * this component owns only the employee's words, the summary, the Loom link,
 * and the save/submit surface. */
export function EodStructuredComposer({
  structured,
  dayLabel = "today",
  clockedOut = false,
  shiftOpen = false,
  loomEnabled = true,
  summaryStreaming = false,
  screenshots = null,
  onOpenDashboard,
  onSave,
  onWriteSummary,
  onSubmit,
  onRedraft,
  onDelete,
  onReload,
}: EodStructuredComposerProps) {
  const [completed, setCompleted] = useState<string[]>(() => linesFor(structured.completed));
  const [inProgress, setInProgress] = useState<string[]>(() => linesFor(structured.inProgress));
  const [next, setNext] = useState<string[]>(() => linesFor(structured.next));
  const [summary, setSummary] = useState(structured.summary);
  const [summaryGeneratedAt, setSummaryGeneratedAt] = useState(structured.summaryGeneratedAt);
  const [summarySource, setSummarySource] = useState(structured.summarySource);
  const [summarySignature, setSummarySignature] = useState(structured.summarySignature);
  const [writing, setWriting] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [loomUrl, setLoomUrl] = useState(structured.loomUrl ?? "");
  const [loomDraft, setLoomDraft] = useState("");
  const [loomError, setLoomError] = useState(false);
  const [openSource, setOpenSource] = useState<string | null>(structured.evidence[0]?.source ?? null);
  const [page, setPage] = useState<Record<FieldKey, number>>({ completed: 0, inProgress: 0, next: 0 });
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string; conflict?: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [reloadPending, setReloadPending] = useState(false);

  const setLines = useCallback((field: FieldKey, value: string[]) => {
    if (field === "completed") setCompleted(value);
    else if (field === "inProgress") setInProgress(value);
    else setNext(value);
  }, []);
  const linesOf = useCallback((field: FieldKey) => {
    if (field === "completed") return completed;
    if (field === "inProgress") return inProgress;
    return next;
  }, [completed, inProgress, next]);

  const composition = useMemo(() => ({
    completed: cleanEodLines(completed),
    inProgress: cleanEodLines(inProgress),
    next: cleanEodLines(next),
  }), [completed, inProgress, next]);
  const complete = eodCompositionIsComplete(composition);
  const current = eodSummaryIsCurrent({ ...composition, summary, summarySignature });
  const mode = eodSummaryMode({
    ...composition,
    summary,
    summarySignature,
    writing: writing || summaryStreaming,
  });
  const input: EodCompositionInput = {
    ...composition,
    summary,
    summaryGeneratedAt,
    summarySource,
    summarySignature,
    loomUrl: loomUrl || null,
  };

  const latest = useRef(input);
  const dirty = useRef(false);
  const firstRender = useRef(true);
  const saveRef = useRef(onSave);
  const summaryAbort = useRef<AbortController | null>(null);
  const recovery = useRef<EodCompositionInput | null>(null);
  const suppressSave = useRef(false);

  useEffect(() => { latest.current = input; }, [input]);
  useEffect(() => { saveRef.current = onSave; }, [onSave]);
  const adoptStructured = useCallback(() => {
    setCompleted(linesFor(structured.completed));
    setInProgress(linesFor(structured.inProgress));
    setNext(linesFor(structured.next));
    setSummary(structured.summary);
    setSummaryGeneratedAt(structured.summaryGeneratedAt);
    setSummarySource(structured.summarySource);
    setSummarySignature(structured.summarySignature);
    setLoomUrl(structured.loomUrl ?? "");
    dirty.current = false;
  }, [structured]);

  useEffect(() => {
    if (dirty.current && !reloadPending) return;
    adoptStructured();
    setReloadPending(false);
  }, [structured, reloadPending, adoptStructured]);

  const markDirty = useCallback(() => {
    dirty.current = true;
  }, []);

  const flight = useMemo(() => createSaveFlight<EodCompositionInput>(async (snapshot) => {
    setSaveState("saving");
    try {
      const result = await saveRef.current(snapshot);
      setSaveState(result);
      setNotice(null);
      if (JSON.stringify(snapshot) === JSON.stringify(latest.current)) dirty.current = false;
    } catch (error) {
      setSaveState("error");
      setNotice(saveFailureNotice(error));
    }
  }), []);

  const persistLatest = useCallback(async () => {
    await flight(latest.current);
  }, [flight]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!dirty.current || writing || submitting || summaryStreaming) return;
    const timer = window.setTimeout(() => { void persistLatest(); }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [completed, inProgress, next, summary, summaryGeneratedAt, summarySource, summarySignature, loomUrl, writing, submitting, summaryStreaming, persistLatest]);

  const flush = useCallback(() => {
    if (!suppressSave.current && dirty.current) void flight(latest.current);
  }, [flight]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  useEffect(() => () => {
    flush();
    summaryAbort.current?.abort();
  }, [flush]);

  const updateLine = (field: FieldKey, index: number, value: string) => {
    const currentLines = linesOf(field);
    const nextLines = currentLines.length ? [...currentLines] : [""];
    nextLines[index] = value;
    setLines(field, nextLines);
    markDirty();
  };

  const removeLine = (field: FieldKey, index: number) => {
    const nextLines = linesOf(field).filter((_, currentIndex) => currentIndex !== index);
    setLines(field, nextLines.length ? nextLines : [""]);
    markDirty();
  };

  const addLine = (field: FieldKey) => {
    if (linesOf(field).filter((line) => line.trim()).length >= MAX_LINES) return;
    setLines(field, [...linesOf(field), ""]);
    markDirty();
  };

  const addSuggestion = (field: FieldKey, text: string) => {
    const currentLines = linesOf(field).filter((line) => line.trim());
    if (currentLines.some((line) => line.toLowerCase() === text.toLowerCase())) return;
    if (currentLines.length >= MAX_LINES) return;
    setLines(field, [...currentLines, text]);
    markDirty();
  };

  const writeSummary = async () => {
    if (!complete || writing) return;
    summaryAbort.current?.abort();
    const controller = new AbortController();
    summaryAbort.current = controller;
    const snapshot = { ...composition };
    setWriting(true);
    setStreamingText("");
    setNotice(null);
    let text = "";
    try {
      const result = await onWriteSummary(snapshot, (chunk) => {
        text += chunk;
        setStreamingText(text);
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (!text.trim()) throw new Error("The summary came back empty. Try again.");
      setSummary(text);
      setStreamingText("");
      setSummaryGeneratedAt(new Date().toISOString());
      setSummarySource(result.source);
      setSummarySignature(eodCompositionSignature(snapshot));
      markDirty();
    } catch (error) {
      if (controller.signal.aborted) return;
      setStreamingText("");
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "The summary could not be written. Try again." });
    } finally {
      if (summaryAbort.current === controller) summaryAbort.current = null;
      setWriting(false);
    }
  };

  const attachLoom = () => {
    const normalized = normalizeLoomShareUrl(loomDraft);
    if (!normalized) {
      setLoomError(Boolean(loomDraft.trim()));
      return;
    }
    setLoomUrl(normalized);
    setLoomDraft("");
    setLoomError(false);
    markDirty();
  };

  const removeLoom = () => {
    setLoomUrl("");
    markDirty();
  };

  const submit = async () => {
    if (!complete || !current || writing || submitting) return;
    suppressSave.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await onSubmit(input, crypto.randomUUID());
      dirty.current = false;
      if (result === "queued") {
        setNotice({ tone: "info", text: "Queued on this device — your report will be sent when the connection returns." });
      }
    } catch (error) {
      suppressSave.current = false;
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "The report could not be submitted." });
    } finally {
      setSubmitting(false);
    }
  };

  const reloadReport = () => {
    recovery.current = latest.current;
    setRecoveryAvailable(true);
    setReloadPending(true);
    setNotice({ tone: "info", text: "The saved report is loaded. Your earlier text is kept; restore it if it is still yours." });
    adoptStructured();
    setReloadPending(false);
    onReload?.();
  };

  const restoreRecovery = () => {
    const saved = recovery.current;
    if (!saved) return;
    setCompleted(linesFor(cleanEodLines(saved.completed)));
    setInProgress(linesFor(cleanEodLines(saved.inProgress)));
    setNext(linesFor(cleanEodLines(saved.next)));
    setSummary(typeof saved.summary === "string" ? saved.summary : "");
    setSummaryGeneratedAt(typeof saved.summaryGeneratedAt === "string" ? saved.summaryGeneratedAt : null);
    setSummarySource(saved.summarySource === "otto" || saved.summarySource === "assembled" ? saved.summarySource : null);
    setSummarySignature(typeof saved.summarySignature === "string" ? saved.summarySignature : null);
    setLoomUrl(normalizeLoomShareUrl(saved.loomUrl) ?? "");
    dirty.current = true;
    setRecoveryAvailable(false);
    setNotice(null);
  };

  const reason = saveState === "saving"
    ? "Saving your draft…"
    : saveState === "queued"
      ? "Saved on this device; it will send when online."
      : saveState === "error"
        ? "Not saved. Your text is still here."
        : !complete
          ? "Each section needs at least one line."
          : mode === "writing"
            ? "Otto is writing the summary."
            : mode === "ready"
              ? "Write the summary before submitting."
              : !current
                ? "The summary is out of date. Refresh it."
                : "Submit when it reads true.";
  const saveLabel = saveState === "saving"
    ? "Saving…"
    : saveState === "queued"
      ? "Queued — will send when online"
      : saveState === "error"
        ? "Not saved — your text is still here"
        : "Saved just now";
  const summaryOwner = summarySource === "assembled" ? "Assembled from your entries" : "Otto · written from your entries";
  const summaryStateLabel = mode === "empty"
    ? "Waiting on your entries"
    : mode === "ready"
      ? "Ready to write"
      : mode === "writing"
        ? "Otto is writing"
        : mode === "stale"
          ? "Out of date"
          : "Up to date";
  const openGroup = structured.evidence.find((group) => group.source === openSource) ?? null;

  return (
    <section className={`panel eod-composer eod-structured eod-structured-${mode}`} aria-label="End-of-day report">
      <header className="eod-structured-head">
        <div>
          <span className="eod-structured-eyebrow">End of day</span>
          <h2>Your day, in your words.</h2>
          <p>{dayLabel === "today" ? "Today" : dayLabel} · built from the recorded day. Suggestions come from the record; keep what is true.</p>
          {clockedOut ? <small className="eod-structured-clocked-out">Your shift was clocked out automatically when this draft was created.</small> : null}
        </div>
        <div className="eod-structured-actions">
          <button type="button" className="quiet-action" onClick={onRedraft} disabled={saveState === "saving" || writing || submitting}>
            <RotateCw size={13} aria-hidden /> Rebuild from record
          </button>
          {onDelete ? <button type="button" className="quiet-action eod-delete-draft" onClick={onDelete} disabled={saveState === "saving" || writing || submitting}>
            <Trash2 size={13} aria-hidden /> Delete draft
          </button> : null}
        </div>
      </header>

      {shiftOpen && onOpenDashboard ? <p className="eod-shift-open-notice" role="status">
        Your shift is still open. <button type="button" className="eod-inline-action" onClick={onOpenDashboard}>Clock out from the dashboard</button> when you are done, then finish this report.
      </p> : null}

      <section className={`eod-structured-summary is-${mode}`} aria-labelledby="eod-structured-summary-title">
        <header>
          <div>
            <h3 id="eod-structured-summary-title">Summary</h3>
            <span>{summaryOwner}</span>
          </div>
          <span className="eod-structured-summary-state"><i aria-hidden /> {summaryStateLabel}</span>
        </header>
        <div className="eod-structured-summary-body" aria-live="polite" aria-busy={writing || summaryStreaming}>
          {mode === "empty" ? <p className="eod-structured-placeholder">Your opening paragraph writes itself once Completed, In progress and Next each carry a line.</p> : null}
          {mode === "ready" ? <p className="eod-structured-placeholder">All three sections are in. Write the opening paragraph when you’re ready.</p> : null}
          {mode !== "empty" && mode !== "ready" ? <p className="eod-structured-summary-text">
            {writing || summaryStreaming ? (streamingText || "…") : summary}{writing || summaryStreaming ? <span className="eod-structured-cursor" aria-hidden /> : null}
          </p> : null}
        </div>
        <footer>
          <span>{mode === "stale" ? <><strong>Your entries changed.</strong> Refresh the summary before submitting.</> : mode === "done" ? <><strong>Saved with this composition.</strong> Editing any line makes it stale.</> : <><strong>Otto uses only these words.</strong> No new claims.</>}</span>
          {mode === "ready" || mode === "stale" ? <button type="button" className="eod-structured-summary-action" onClick={() => void writeSummary()} disabled={!complete || writing || summaryStreaming}>
            {mode === "stale" ? "Refresh summary" : "Write the summary"}
          </button> : null}
        </footer>
      </section>

      <div className="eod-structured-sections">
        {FIELDS.map((field) => {
          const meta = FIELD_META[field];
          const lines = linesFor(linesOf(field));
          const used = new Set(composition[field].map((line) => line.toLowerCase()));
          const suggestions = structured.suggestions[field];
          const pageCount = Math.max(1, Math.ceil(suggestions.length / SUGGESTIONS_PER_PAGE));
          const visible = suggestions.slice(page[field] * SUGGESTIONS_PER_PAGE, page[field] * SUGGESTIONS_PER_PAGE + SUGGESTIONS_PER_PAGE);
          const rangeStart = suggestions.length ? page[field] * SUGGESTIONS_PER_PAGE + 1 : 0;
          const rangeEnd = Math.min(suggestions.length, (page[field] + 1) * SUGGESTIONS_PER_PAGE);
          return <article key={field} className="eod-structured-section" aria-labelledby={`eod-structured-${field}`}>
            <div className="eod-structured-label">
              <span>{meta.number}</span>
              <h3 id={`eod-structured-${field}`}>{meta.title}</h3>
              <p>{meta.description}</p>
              <small>{composition[field].length} {composition[field].length === 1 ? "line" : "lines"}</small>
            </div>
            <div className="eod-structured-body">
              <div className="eod-structured-lines">
                {lines.map((line, index) => <div key={index} className="eod-structured-line">
                  <span className="eod-structured-bullet" aria-hidden />
                  <input
                    value={line}
                    onChange={(event) => updateLine(field, index, event.target.value)}
                    aria-label={`${meta.title} line ${index + 1}`}
                    maxLength={EOD_MAX_LINE_CHARS}
                    placeholder={index === 0 ? meta.placeholder : "Add another line…"}
                  />
                  <button type="button" className="eod-structured-line-remove" onClick={() => removeLine(field, index)} aria-label={`Delete ${meta.title} line ${index + 1}`} title="Delete this line">
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>)}
              </div>
              <button type="button" className="eod-structured-add" onClick={() => addLine(field)} disabled={composition[field].length >= MAX_LINES}>
                <Plus size={12} aria-hidden /> Add another line
              </button>
              {suggestions.length ? <div className="eod-structured-suggest">
                <header>
                  <strong>{meta.source}</strong>
                  <span>Click to add</span>
                  <span className="eod-structured-range">{rangeStart}–{rangeEnd} of {suggestions.length}</span>
                  <span className="eod-structured-pager">
                    <button type="button" onClick={() => setPage((current) => ({ ...current, [field]: Math.max(0, current[field] - 1) }))} disabled={page[field] === 0} aria-label="Previous suggestions"><ChevronLeft size={12} aria-hidden /></button>
                    <button type="button" onClick={() => setPage((current) => ({ ...current, [field]: Math.min(pageCount - 1, current[field] + 1) }))} disabled={page[field] >= pageCount - 1} aria-label="More suggestions"><ChevronRight size={12} aria-hidden /></button>
                  </span>
                </header>
                <div className="eod-structured-pills">
                  {visible.map((text) => {
                    const consumed = used.has(text.toLowerCase());
                    return <button key={text} type="button" className={`eod-structured-pill${consumed ? " is-consumed" : ""}`} onClick={() => addSuggestion(field, text)} disabled={consumed}>
                      <span aria-hidden>+</span><span>{text}</span>
                    </button>;
                  })}
                </div>
              </div> : null}
            </div>
          </article>;
        })}
      </div>

      {loomEnabled ? <section className="eod-structured-loom" aria-labelledby="eod-structured-loom-title">
        <div className="eod-structured-label">
          <span>04</span>
          <h3 id="eod-structured-loom-title">Recording <small>Optional</small></h3>
          <p>Attach one Loom share link.</p>
        </div>
        <div className="eod-structured-loom-body">
          {loomUrl ? <div className="eod-structured-loom-card">
            <Video size={16} aria-hidden />
            <span><strong>Loom recording attached</strong><small>{loomUrl.replace(/^https:\/\/(?:www\.)?loom\.com\/share\//, "loom.com/share/")}</small></span>
            <a href={loomUrl} target="_blank" rel="noreferrer">Open <ExternalLink size={10} aria-hidden /></a>
            <button type="button" onClick={removeLoom}>Remove</button>
          </div> : <>
            <div className="eod-structured-loom-input">
              <input value={loomDraft} onChange={(event) => { setLoomDraft(event.target.value); setLoomError(false); }} placeholder="https://www.loom.com/share/…" aria-label="Loom share link (optional)" />
              <button type="button" onClick={attachLoom} disabled={!normalizeLoomShareUrl(loomDraft)}>Attach</button>
            </div>
            <p className={loomError ? "is-error" : undefined}>{loomError ? "Use a loom.com share link." : "A share link, not a download. Stored and linked; not analyzed by Otto in this pass."}</p>
          </>}
        </div>
      </section> : null}

      <section className="eod-structured-evidence" aria-labelledby="eod-structured-evidence-title">
        <header>
          <h3 id="eod-structured-evidence-title">Recorded evidence</h3>
          <span><Lock size={10} aria-hidden /> Immutable · system-recorded</span>
        </header>
        <p>Recorded by Work OS from your connected tools. Attached to the report; it cannot be edited here.</p>
        {structured.evidence.length ? <>
          <div className="eod-structured-sources" role="group" aria-label="Evidence sources">
            {structured.evidence.map((group) => <button key={group.source} type="button" aria-expanded={openSource === group.source} onClick={() => setOpenSource((current) => current === group.source ? null : group.source)}>
              {group.label} <b>{group.items.length}</b><ChevronDown size={11} aria-hidden />
            </button>)}
          </div>
          {openGroup ? <div className="eod-structured-evidence-panel" aria-label={`${openGroup.label} evidence`}>
            <header><strong>{openGroup.items.length} {openGroup.items.length === 1 ? "record" : "records"}</strong><span>Read-only · fixed to this report</span></header>
            <ul>
              {openGroup.items.map((item) => <li key={item.id}>
                <div>
                  {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title} <ExternalLink size={10} aria-hidden /></a> : <strong>{item.title}</strong>}
                  {item.summary ? <p>{item.summary}</p> : null}
                  {item.meta ? <small>{item.meta}</small> : null}
                </div>
                {item.at ? <time dateTime={item.at}>{formatAt(item.at)}</time> : null}
              </li>)}
            </ul>
          </div> : null}
        </> : <p>No evidence was attached to this report.</p>}
        {screenshots}
      </section>

      {notice ? <p className={`eod-structured-notice is-${notice.tone}`} role="status">
        {notice.text}
        {notice.conflict && onReload ? <button type="button" className="eod-structured-reload" onClick={reloadReport}>Reload report</button> : null}
        {recoveryAvailable ? <button type="button" className="eod-structured-reload" onClick={restoreRecovery}>Restore my text</button> : null}
      </p> : null}

      <footer className="eod-structured-footer">
        <span className={`eod-structured-save is-${saveState}`}><i aria-hidden /> {saveLabel}</span>
        <span className="eod-structured-reason" id="eod-structured-reason">{reason}</span>
        <button type="button" className="eod-structured-submit" onClick={() => void submit()} disabled={!complete || !current || writing || submitting} aria-describedby="eod-structured-reason">
          Submit for review <ArrowRight size={13} aria-hidden />
        </button>
      </footer>
    </section>
  );
}
