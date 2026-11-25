"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowRight,
  Check,
  CircleDashed,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { EodEvidenceSources } from "@/modules/work-os/eod-structured-view";
import {
  assembleEodSummary,
  cleanEodLines,
  eodCompositionIsComplete,
  eodCompositionSignature,
  eodEvidenceCount,
  eodSummaryIsCurrent,
  normalizeLoomShareUrl,
  type EodStructuredReport,
} from "@/modules/work-os/eod-structured";
import { parseEodMarkdown, splitEodRecapRow, splitEodTaskRow } from "@/modules/work-os/eod-document";
import { fetchJson, requestId, type AnyRow } from "./model";
import styles from "./EmployeeEodComposer.module.css";

type FieldKey = "completed" | "inProgress" | "next";
type LocalLine = { id: string; text: string };
type LineState = Record<FieldKey, LocalLine[]>;
type FocusTarget = { field: FieldKey; id: string } | null;

const FIELDS: Array<{
  key: FieldKey;
  index: string;
  title: string;
  help: string;
  placeholder: string;
  source: string;
  marker: typeof Check;
  markerClass: string;
}> = [
  {
    key: "completed",
    index: "01",
    title: "Completed",
    help: "What actually landed today.",
    placeholder: "Add what landed…",
    source: "From today's record",
    marker: Check,
    markerClass: "",
  },
  {
    key: "inProgress",
    index: "02",
    title: "In progress",
    help: "What is still moving.",
    placeholder: "Add what is still moving…",
    source: "From your recap",
    marker: CircleDashed,
    markerClass: styles.lineMarkProgress,
  },
  {
    key: "next",
    index: "03",
    title: "Next",
    help: "Where tomorrow starts.",
    placeholder: "Add where tomorrow starts…",
    source: "From your plan",
    marker: ArrowRight,
    markerClass: styles.lineMarkNext,
  },
];

function limitLines(lines: string[]): string[] {
  return cleanEodLines(lines);
}

function withTrailing(lines: LocalLine[], makeLine: (text?: string) => LocalLine): LocalLine[] {
  const next = [...lines];
  // Keep exactly one writable blank row at the end. Enter from the middle of
  // the list must not leave the previous trailing row plus a second blank.
  while (next.length > 1 && !next[next.length - 1].text.trim() && !next[next.length - 2].text.trim()) next.pop();
  if (!next.length || next[next.length - 1].text.trim()) next.push(makeLine());
  return next;
}

function seedLines(structured: EodStructuredReport, legacyMarkdown: string, prefix: string): LineState {
  const legacy = !structured.preparedAt && legacyMarkdown ? parseEodMarkdown(legacyMarkdown) : null;
  const section = (key: "completed" | "progress" | "next") => legacy?.sections.find((item) => item.key === key && item.level === 2);
  const legacyCompleted = section("completed")?.lines
    .filter((line) => line.kind === "bullet")
    .map((line) => splitEodTaskRow(line.text).title)
    .filter(Boolean) ?? [];
  const legacyProgress = section("progress")?.lines
    .filter((line) => line.kind === "bullet")
    .map((line) => splitEodRecapRow(line.text)?.headline ?? line.text)
    .filter(Boolean) ?? [];
  const legacyNext = section("next")?.lines
    .filter((line) => line.kind === "bullet")
    .map((line) => splitEodTaskRow(line.text).title)
    .filter(Boolean) ?? [];
  const source: Record<FieldKey, string[]> = {
    completed: structured.completed.length ? structured.completed : legacyCompleted,
    inProgress: structured.inProgress.length ? structured.inProgress : legacyProgress,
    next: structured.next.length ? structured.next : legacyNext,
  };
  let counter = 0;
  const make = (text = ""): LocalLine => ({ id: `${prefix}-${counter++}`, text });
  return {
    completed: withTrailing(source.completed.map(make), make),
    inProgress: withTrailing(source.inProgress.map(make), make),
    next: withTrailing(source.next.map(make), make),
  };
}

function legacySummary(markdown: string): string {
  const document = parseEodMarkdown(markdown);
  return document.summary?.lines.map((line) => line.text).join(" ").trim() ?? "";
}

function resizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function snapshotKey(snapshot: {
  composition: { completed: string[]; inProgress: string[]; next: string[] };
  summary: string;
  summaryGeneratedAt: string | null;
  summarySource: "otto" | "assembled" | null;
  summarySignature: string | null;
  loomUrl: string;
}): string {
  return JSON.stringify([
    snapshot.composition,
    snapshot.summary,
    snapshot.summaryGeneratedAt,
    snapshot.summarySource,
    snapshot.summarySignature,
    snapshot.loomUrl,
  ]);
}

function SuggestionRail({
  suggestions,
  source,
  onPick,
}: {
  suggestions: string[];
  source: string;
  onPick: (text: string) => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState("");
  const [atEnd, setAtEnd] = useState(false);
  const [scrollable, setScrollable] = useState(false);

  const update = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const pills = Array.from(el.children) as HTMLElement[];
    if (!pills.length) {
      setCount("0 of 0");
      setScrollable(false);
      setAtEnd(true);
      return;
    }
    const view = el.getBoundingClientRect();
    const visible = pills
      .map((pill, index) => ({ index, rect: pill.getBoundingClientRect() }))
      .filter(({ rect }) => {
        const left = Math.max(rect.left, view.left);
        const right = Math.min(rect.right, view.right);
        return right - left > rect.width * 0.55;
      });
    const first = visible.length ? visible[0].index + 1 : 1;
    const last = visible.length ? visible[visible.length - 1].index + 1 : Math.min(2, pills.length);
    setCount(first === last ? `${first} of ${pills.length}` : `${first}–${last} of ${pills.length}`);
    const max = el.scrollWidth - el.clientWidth;
    const end = el.scrollLeft >= max - 3;
    setScrollable(max > 4);
    setAtEnd(end);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [suggestions, update]);

  useEffect(() => {
    const onResize = () => update();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [update]);

  if (!suggestions.length) {
    return <p className={styles.suggestEmpty}><Check size={11} aria-hidden />Every suggestion from your record is in the report.</p>;
  }

  const scroll = () => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    el.scrollTo({ left: atEnd ? 0 : Math.min(el.scrollLeft + el.clientWidth * 0.86, max), behavior: "smooth" });
  };

  return (
    <div className={styles.suggest}>
      <div className={styles.suggestHead}>
        <span className={styles.suggestKicker}><span className={styles.suggestDot} aria-hidden />{source}</span>
        <span className={styles.suggestHint}>Click to add</span>
        <span className={styles.suggestNav}>
          <span className={styles.suggestCount}>{count}</span>
          <button
            type="button"
            className={`${styles.railArrow} ${scrollable && atEnd ? styles.arrowFlipped : ""}`}
            disabled={!scrollable}
            onClick={scroll}
            aria-label={atEnd ? "Back to the first suggestions" : "Show more suggestions"}
          >
            <ArrowRight aria-hidden />
          </button>
        </span>
      </div>
      <div className={`${styles.suggestWrap} ${atEnd ? styles.suggestAtEnd : ""}`}>
        <div className={styles.suggestScroll} ref={scroller} onScroll={update} role="group" aria-label={`${source} suggestions`}>
          {suggestions.map((text) => (
            <button key={text} type="button" className={styles.pill} onClick={() => onPick(text)} aria-label={`Add suggestion: ${text}`}>
              <span className={styles.pillPlus} aria-hidden><Plus /></span>
              <span className={styles.pillText}>{text}</span>
            </button>
          ))}
        </div>
        <span className={styles.suggestFade} aria-hidden />
      </div>
    </div>
  );
}

function EodField({
  field,
  meta,
  lines,
  suggestions,
  focusTarget,
  onFocusHandled,
  onUpdate,
  onAddLine,
  onRemoveLine,
  onSuggestion,
}: {
  field: FieldKey;
  meta: (typeof FIELDS)[number];
  lines: LocalLine[];
  suggestions: string[];
  focusTarget: FocusTarget;
  onFocusHandled: () => void;
  onUpdate: (field: FieldKey, id: string, text: string) => void;
  onAddLine: (field: FieldKey, afterId: string, text?: string) => void;
  onRemoveLine: (field: FieldKey, id: string) => void;
  onSuggestion: (field: FieldKey, text: string) => void;
}) {
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  const Icon = meta.marker;
  const nonEmpty = lines.filter((line) => line.text.trim()).length;

  useEffect(() => {
    for (const el of refs.current.values()) resizeTextarea(el);
  }, [lines]);

  useEffect(() => {
    if (!focusTarget || focusTarget.field !== field) return;
    const el = refs.current.get(focusTarget.id);
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    onFocusHandled();
  }, [field, focusTarget, onFocusHandled]);

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>, line: LocalLine, index: number) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!line.text.trim() && index === lines.length - 1) return;
      onAddLine(field, line.id);
      return;
    }
    if (event.key === "Backspace" && line.text === "" && lines.length > 1) {
      event.preventDefault();
      onRemoveLine(field, line.id);
    }
  };

  return (
    <article className={styles.field}>
      <header className={styles.fieldHead}>
        <span className={styles.fieldIndex}>{meta.index}</span>
        <div>
          <h3>{meta.title}</h3>
          <p>{meta.help}</p>
          <span className={styles.fieldCount}>{nonEmpty} {nonEmpty === 1 ? "line" : "lines"}</span>
        </div>
      </header>
      <div className={styles.fieldBody}>
        <div className={styles.lines}>
          {lines.map((line, index) => {
            const hasText = Boolean(line.text.trim());
            const isLast = index === lines.length - 1;
            return (
              <div key={line.id} className={`${styles.line} ${hasText ? styles.lineHasText : ""} ${field === "next" ? styles.lineNext : ""}`}>
                <span className={`${styles.lineMark} ${meta.markerClass}`} aria-hidden>
                  {hasText ? <Icon size={10} /> : <Plus size={10} />}
                </span>
                <textarea
                  ref={(el) => {
                    if (el) {
                      refs.current.set(line.id, el);
                      resizeTextarea(el);
                    } else {
                      refs.current.delete(line.id);
                    }
                  }}
                  className={styles.lineInput}
                  rows={1}
                  value={line.text}
                  placeholder={isLast ? meta.placeholder : ""}
                  aria-label={`${meta.title} line ${index + 1}`}
                  onChange={(event) => {
                    onUpdate(field, line.id, event.target.value);
                    resizeTextarea(event.currentTarget);
                  }}
                  onKeyDown={(event) => keyDown(event, line, index)}
                />
                {hasText ? (
                  <button type="button" className={styles.lineRemove} onClick={() => onRemoveLine(field, line.id)} aria-label={`Remove ${meta.title} line ${index + 1}`}>
                    <X aria-hidden />
                  </button>
                ) : <span />}
              </div>
            );
          })}
        </div>
        <SuggestionRail suggestions={suggestions} source={meta.source} onPick={(text) => onSuggestion(field, text)} />
      </div>
    </article>
  );
}

export interface EmployeeEodComposerProps {
  reportId: string;
  reportDate: string;
  initial: EodStructuredReport;
  legacyMarkdown?: string;
  status: "draft" | "rejected";
  onSubmitted?: (report: AnyRow) => void;
}

export default function EmployeeEodComposer({
  reportId,
  reportDate,
  initial,
  legacyMarkdown = "",
  status,
  onSubmitted,
}: EmployeeEodComposerProps) {
  const prefix = useId().replace(/[:]/g, "");
  const lineCounter = useRef(0);
  const makeLine = useCallback((text = ""): LocalLine => ({ id: `${prefix}-line-${lineCounter.current++}`, text }), [prefix]);
  const seed = useMemo(() => seedLines(initial, legacyMarkdown, prefix), [initial, legacyMarkdown, prefix]);
  const [lineState, setLineState] = useState<LineState>(() => seed);
  const initialSummary = initial.summary || (!initial.preparedAt ? legacySummary(legacyMarkdown) : "");
  const [summary, setSummary] = useState(initialSummary);
  const [summarySignature, setSummarySignature] = useState(initial.summarySignature ?? null);
  const [summaryGeneratedAt, setSummaryGeneratedAt] = useState(initial.summaryGeneratedAt ?? null);
  const [summarySource, setSummarySource] = useState<"otto" | "assembled" | null>(initial.summarySource ?? null);
  const [loomUrl, setLoomUrl] = useState(initial.loomUrl ?? "");
  const [loomDraft, setLoomDraft] = useState("");
  const [loomError, setLoomError] = useState(false);
  const [writing, setWriting] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "warn" | "info"; text: string } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);
  const abortRef = useRef<AbortController | null>(null);
  const summaryRef = useRef<HTMLParagraphElement | null>(null);
  const mounted = useRef(false);
  const saveInFlight = useRef(false);
  const saveQueued = useRef(false);
  const dirty = useRef(false);

  const composition = useMemo(() => ({
    completed: limitLines(lineState.completed.map((line) => line.text)),
    inProgress: limitLines(lineState.inProgress.map((line) => line.text)),
    next: limitLines(lineState.next.map((line) => line.text)),
  }), [lineState]);
  const signature = eodCompositionSignature(composition);
  const complete = eodCompositionIsComplete(composition);
  const summaryCurrent = eodSummaryIsCurrent({ ...composition, summary, summarySignature });
  const summaryMode = writing ? "writing" : summaryCurrent ? "done" : summary.trim() ? "stale" : complete ? "ready" : "empty";
  const modeClass = summaryMode === "ready"
    ? styles.isReady
    : summaryMode === "writing"
      ? styles.isWriting
      : summaryMode === "done"
        ? styles.isDone
        : summaryMode === "stale"
          ? styles.isStale
          : "";
  const totalEntries = composition.completed.length + composition.inProgress.length + composition.next.length;
  const latest = useRef({ composition, summary, summaryGeneratedAt, summarySource, summarySignature, loomUrl });
  latest.current = { composition, summary, summaryGeneratedAt, summarySource, summarySignature, loomUrl };

  const persistLatest = useCallback(async () => {
    if (saveInFlight.current) {
      saveQueued.current = true;
      return;
    }
    saveInFlight.current = true;
    const snapshot = latest.current;
    setSaveState("saving");
    try {
      await fetchJson(`/api/work-os/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completed: snapshot.composition.completed,
          inProgress: snapshot.composition.inProgress,
          next: snapshot.composition.next,
          summary: snapshot.summary,
          summaryGeneratedAt: snapshot.summaryGeneratedAt,
          summarySource: snapshot.summarySource,
          summarySignature: snapshot.summarySignature,
          loomUrl: snapshot.loomUrl || null,
        }),
      });
      if (snapshotKey(latest.current) === snapshotKey(snapshot)) {
        dirty.current = false;
        setSaveState("saved");
        setNotice(null);
      } else {
        // The employee kept typing while this request was in flight. Keep the
        // dirty flag; the debounced effect schedules the next serialized save.
        setSaveState("idle");
      }
    } catch (error) {
      setSaveState("idle");
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "The draft could not be saved." });
    } finally {
      saveInFlight.current = false;
      if (saveQueued.current) {
        saveQueued.current = false;
        if (dirty.current) void persistLatest();
      }
    }
  }, [reportId]);

  const usedSuggestions = (field: FieldKey) => new Set(composition[field].map((line) => line.toLowerCase()));
  const suggestions = (field: FieldKey) => {
    const used = usedSuggestions(field);
    return initial.suggestions[field].filter((text) => !used.has(text.toLowerCase())).slice(0, 5);
  };

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!dirty.current || writing || submitting) return;
    const timer = setTimeout(() => {
      void persistLatest();
    }, 700);
    return () => clearTimeout(timer);
  }, [composition, summary, summaryGeneratedAt, summarySource, summarySignature, loomUrl, writing, submitting, persistLatest]);

  useEffect(() => () => {
    abortRef.current?.abort();
    // A date switch unmounts the composer; flush the last dirty snapshot
    // instead of letting the debounce cleanup discard it.
    if (dirty.current) void persistLatest();
  }, [persistLatest]);

  const updateLine = (field: FieldKey, id: string, text: string) => {
    dirty.current = true;
    setLineState((previous) => ({
      ...previous,
      [field]: previous[field].map((line) => line.id === id ? { ...line, text } : line),
    }));
  };

  const addLine = (field: FieldKey, afterId?: string, text = "") => {
    dirty.current = true;
    const line = makeLine(text);
    setLineState((previous) => {
      const list = [...previous[field]];
      const index = afterId ? list.findIndex((item) => item.id === afterId) : list.length - 1;
      list.splice(index >= 0 ? index + 1 : list.length, 0, line);
      return { ...previous, [field]: withTrailing(list, makeLine) };
    });
    setFocusTarget({ field, id: line.id });
  };

  const removeLine = (field: FieldKey, id: string) => {
    dirty.current = true;
    const list = lineState[field];
    const index = list.findIndex((line) => line.id === id);
    const neighbor = list[index - 1] ?? list[index + 1];
    setLineState((previous) => ({
      ...previous,
      [field]: withTrailing(previous[field].filter((line) => line.id !== id), makeLine),
    }));
    if (neighbor) setFocusTarget({ field, id: neighbor.id });
  };

  const addSuggestion = (field: FieldKey, text: string) => {
    const list = lineState[field];
    const trailing = list[list.length - 1];
    if (trailing && !trailing.text.trim()) {
      updateLine(field, trailing.id, text);
      setFocusTarget({ field, id: trailing.id });
      return;
    }
    addLine(field, list[list.length - 1]?.id, text);
  };

  const writeSummary = async () => {
    if (!complete || writing) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const startedSignature = signature;
    setWriting(true);
    setStreamText("");
    setNotice(null);
    try {
      const response = await fetch("/api/work-os/me/eod/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: reportDate,
          completed: composition.completed,
          inProgress: composition.inProgress,
          next: composition.next,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "The summary could not be written. Try again.");
      }
      const source = response.headers.get("X-Work-OS-Summary-Source") === "assembled" ? "assembled" : "otto";
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The summary stream did not start.");
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setStreamText(text);
      }
      text = text.trim();
      if (!text) throw new Error("The summary came back empty. Try again.");
      dirty.current = true;
      setSummary(text);
      setSummarySignature(startedSignature);
      setSummaryGeneratedAt(new Date().toISOString());
      setSummarySource(source);
      setStreamText("");
      const active = document.activeElement;
      if (!(active instanceof HTMLElement && (active.tagName === "TEXTAREA" || active.tagName === "INPUT"))) {
        requestAnimationFrame(() => summaryRef.current?.focus({ preventScroll: true }));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const fallback = assembleEodSummary(composition);
        if (fallback) {
          dirty.current = true;
          setSummary(fallback);
          setSummarySignature(startedSignature);
          setSummaryGeneratedAt(new Date().toISOString());
          setSummarySource("assembled");
          setStreamText("");
          setNotice({
            tone: "warn",
            text: "The live summary stopped. An assembled summary from your entries is ready to review.",
          });
          const active = document.activeElement;
          if (!(active instanceof HTMLElement && (active.tagName === "TEXTAREA" || active.tagName === "INPUT"))) {
            requestAnimationFrame(() => summaryRef.current?.focus({ preventScroll: true }));
          }
        } else {
          setNotice({ tone: "error", text: error instanceof Error ? error.message : "The summary could not be written." });
        }
      }
    } finally {
      if (!controller.signal.aborted) setWriting(false);
    }
  };

  const attachLoom = () => {
    const normalized = normalizeLoomShareUrl(loomDraft);
    if (!normalized) {
      setLoomError(Boolean(loomDraft.trim()));
      return;
    }
    dirty.current = true;
    setLoomUrl(normalized);
    setLoomDraft("");
    setLoomError(false);
  };

  const submit = async () => {
    if (!summaryCurrent || !complete || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await fetchJson<{ report: AnyRow }>(`/api/work-os/reports/${reportId}/submit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
        body: JSON.stringify({
          structured: {
            completed: composition.completed,
            inProgress: composition.inProgress,
            next: composition.next,
            summary,
            summaryGeneratedAt,
            summarySource,
            summarySignature,
            loomUrl: loomUrl || null,
          },
        }),
      });
      onSubmitted?.(result.report);
    } catch (error) {
      setSubmitting(false);
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "The report could not be submitted." });
    }
  };

  const summaryLabel = summaryMode === "empty"
    ? "Waiting on your entries"
    : summaryMode === "ready"
      ? "Ready to write"
      : summaryMode === "writing"
        ? "Writing"
        : summaryMode === "stale"
          ? "Needs a rewrite"
          : `Written ${summaryGeneratedAt ? timeLabel(summaryGeneratedAt) : "just now"}`;
  const displaySummary = writing ? streamText : summary;
  const recordedItems = eodEvidenceCount(initial.evidence);
  const canSubmit = complete && summaryCurrent && !writing && !submitting;
  const reason = summaryMode === "stale"
    ? "Regenerate the summary after your edits."
    : !complete
      ? "Each section needs at least one line. The summary comes after that."
      : !summaryCurrent
        ? "Write the summary before submitting."
        : "Nothing is filed until you submit.";

  return (
    <div className={styles.root}>
      {status === "rejected" ? <div className={`${styles.notice} ${styles.noticeWarn}`}>Your manager requested changes. Update the report and resubmit it.</div> : null}
      {notice ? <div className={`${styles.notice} ${notice.tone === "error" ? styles.noticeError : notice.tone === "warn" ? styles.noticeWarn : ""}`}>{notice.text}</div> : null}

      <section className={`${styles.summaryCard} ${modeClass}`} aria-labelledby={`${prefix}-summary`} aria-busy={writing}>
        <p className={styles.srOnly} aria-live="polite">{writing ? "Otto is writing the summary." : summaryCurrent ? "Summary ready. Review it before submitting." : ""}</p>
        <header className={styles.summaryHead}>
          <div className={styles.summaryLabel}>
            <span className={styles.summaryRule} aria-hidden />
            <strong id={`${prefix}-summary`}>Summary</strong>
            <span className={styles.summaryOwner}>{summarySource === "assembled" ? "Assembled from your entries" : "Otto · written from your entries"}</span>
          </div>
          <span className={styles.summaryState}><span className={styles.stateDot} aria-hidden />{summaryLabel}</span>
        </header>
        <div className={styles.summaryBody}>
          {writing || displaySummary ? (
            <p ref={summaryRef} className={styles.summaryText} tabIndex={-1}>
              {writing ? streamText : summary}
              {writing ? <span className={styles.caret} aria-hidden /> : null}
            </p>
          ) : (
            <>
              <p className={styles.summaryPlaceholder}>
                {complete
                  ? "All three sections are in. Write the opening paragraph when you’re ready."
                  : "Your opening paragraph writes itself once Completed, In progress and Next each carry a line."}
              </p>
              <div className={styles.blankRules} aria-hidden><i /><i /><i /></div>
            </>
          )}
        </div>
        {summaryMode !== "empty" ? (
          <footer className={styles.summaryFoot}>
            <span className={`${styles.summaryFootCopy} ${summaryMode === "stale" ? styles.isStale : ""}`}>
              <span className={styles.footDot} aria-hidden />
              {summaryMode === "ready" ? <>All three sections have a line. <strong>Otto will use only these words.</strong></> : null}
              {summaryMode === "writing" ? <>Otto is reading your day<span className={styles.writingDots} aria-hidden><i /><i /><i /></span></> : null}
              {summaryMode === "done" ? <>Written from <strong>{totalEntries} {totalEntries === 1 ? "entry" : "entries"}</strong> and <strong>{recordedItems} recorded items</strong>.</> : null}
              {summaryMode === "stale" ? (complete ? <>Entries changed since this summary.</> : <>Complete all three sections to rewrite the summary.</>) : null}
            </span>
            <span className={styles.summaryFootActions}>
              {summaryMode === "ready" ? (
                <button type="button" className={styles.primaryButton} onClick={() => void writeSummary()}>
                  Write the summary <ArrowRight size={12} aria-hidden />
                </button>
              ) : null}
              {summaryMode === "stale" ? (
                <button type="button" className={styles.secondaryButton} disabled={!complete} onClick={() => void writeSummary()}>
                  <RotateCcw size={11} aria-hidden /> Regenerate summary
                </button>
              ) : null}
            </span>
          </footer>
        ) : null}
      </section>

      {FIELDS.map((meta) => (
        <EodField
          key={meta.key}
          field={meta.key}
          meta={meta}
          lines={lineState[meta.key]}
          suggestions={suggestions(meta.key)}
          focusTarget={focusTarget}
          onFocusHandled={() => setFocusTarget(null)}
          onUpdate={updateLine}
          onAddLine={addLine}
          onRemoveLine={removeLine}
          onSuggestion={addSuggestion}
        />
      ))}

      <section className={styles.attachField} aria-labelledby={`${prefix}-recording`}>
        <header className={styles.fieldHead}>
          <span className={styles.fieldIndex}>04</span>
          <div>
            <h3 id={`${prefix}-recording`}>Recording <span className={styles.optional}>Optional</span></h3>
            <p>Attach a Loom to this report.</p>
          </div>
        </header>
        <div className={styles.fieldBody}>
          {loomUrl ? (
            <div className={styles.loomAttached}>
              <img className={styles.loomAttachedMark} src="/brand/loom-mark.png" alt="" />
              <span className={styles.loomAttachedMain}><strong>Loom recording attached</strong><span>{loomUrl.replace(/^https?:\/\/(www\.)?/, "")}</span></span>
              <a className={styles.loomLink} href={loomUrl} target="_blank" rel="noreferrer">Open</a>
              <button type="button" className={styles.loomRemove} onClick={() => { dirty.current = true; setLoomUrl(""); }}>Remove</button>
            </div>
          ) : (
            <>
              <div className={styles.loomInputRow}>
                <img className={styles.loomMark} src="/brand/loom-mark.png" alt="" />
                <input
                  className={styles.loomInput}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={loomDraft}
                  placeholder="https://www.loom.com/share/…"
                  aria-label="Loom share link (optional)"
                  onChange={(event) => { setLoomDraft(event.target.value); setLoomError(false); }}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); attachLoom(); } }}
                />
                <button type="button" className={styles.secondaryButton} disabled={!normalizeLoomShareUrl(loomDraft)} onClick={attachLoom}>Attach</button>
              </div>
              <p className={`${styles.loomHint} ${loomError ? styles.loomHintError : ""}`}>
                {loomError ? "Use a loom.com share link — for example, https://www.loom.com/share/…" : "A share link, not a download. The recording is attached when you submit."}
              </p>
            </>
          )}
        </div>
      </section>

      <section className={styles.evidenceBlock} aria-labelledby={`${prefix}-evidence`}>
        <header className={styles.evidenceHead}>
          <div>
            <span className={styles.evidenceEyebrow}>05 · Recorded</span>
            <span className={styles.summaryLabel}><span className={styles.summaryRule} aria-hidden /><strong id={`${prefix}-evidence`}>Evidence</strong></span>
            <p>Recorded by Work OS from your connected tools. It is attached to the report and cannot be edited here.</p>
          </div>
          <span className={styles.immutable}>Immutable</span>
        </header>
        <EodEvidenceSources groups={initial.evidence} />
      </section>

      <footer className={styles.foot}>
        <ul className={styles.checks}>
          {FIELDS.map((meta) => {
            const count = composition[meta.key].length;
            const done = count > 0;
            return (
              <li key={meta.key} className={`${styles.check} ${done ? styles.checkDone : ""}`}>
                <span className={styles.checkMark}><Check aria-hidden /></span>
                <span>{meta.title}</span>
                <span className={styles.checkState}>{done ? `${count} ${count === 1 ? "line" : "lines"}` : "Empty"}</span>
              </li>
            );
          })}
          <li className={`${styles.check} ${summaryCurrent ? styles.checkDone : ""}`}>
            <span className={styles.checkMark}><Check aria-hidden /></span>
            <span>Summary</span>
            <span className={styles.checkState}>{summaryCurrent ? "Written" : summaryMode === "writing" ? "Writing…" : summaryMode === "stale" ? "Needs rewrite" : "Waiting"}</span>
          </li>
        </ul>
        <div className={styles.footActions}>
          <span className={styles.footNote}>
            {reason}
            {saveState === "saving" ? " Saving…" : saveState === "saved" ? " Saved just now." : ""}
          </span>
          <button type="button" className={styles.primaryButton} disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? "Submitting…" : "Submit for review"} <ArrowRight size={12} aria-hidden />
          </button>
        </div>
      </footer>
    </div>
  );
}
