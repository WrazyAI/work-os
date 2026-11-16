import type { Span } from "@/modules/work-os/payroll/contracts";

function assertSpan(span: Span): void {
  if (!span || !Number.isSafeInteger(span.startMs) || !Number.isSafeInteger(span.endMs) || span.endMs <= span.startMs) {
    throw new Error("Payroll spans must be half-open with integer millisecond endpoints");
  }
}

/** Merge touching/overlapping half-open spans. Touching is merged because
 * elapsed duration is a measure: [0,5)+[5,10) is still ten minutes. */
export function unionSpans(spans: Span[]): Span[] {
  if (!spans.length) return [];
  const sorted = spans.map((span) => { assertSpan(span); return { startMs: span.startMs, endMs: span.endMs }; })
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const merged: Span[] = [sorted[0]];
  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (span.startMs <= last.endMs) last.endMs = Math.max(last.endMs, span.endMs);
    else merged.push(span);
  }
  return merged;
}

export function intersectSpans(a: Span[], b: Span[]): Span[] {
  const left = unionSpans(a);
  const right = unionSpans(b);
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i].startMs, right[j].startMs);
    const end = Math.min(left[i].endMs, right[j].endMs);
    if (start < end) out.push({ startMs: start, endMs: end });
    if (left[i].endMs < right[j].endMs) i += 1;
    else j += 1;
  }
  return out;
}

export function subtractSpans(a: Span[], b: Span[]): Span[] {
  const left = unionSpans(a);
  const right = unionSpans(b);
  const out: Span[] = [];
  let j = 0;
  for (const span of left) {
    let cursor = span.startMs;
    while (j < right.length && right[j].endMs <= cursor) j += 1;
    let k = j;
    while (k < right.length && right[k].startMs < span.endMs) {
      if (right[k].startMs > cursor) out.push({ startMs: cursor, endMs: Math.min(right[k].startMs, span.endMs) });
      cursor = Math.max(cursor, right[k].endMs);
      if (cursor >= span.endMs) break;
      k += 1;
    }
    if (cursor < span.endMs) out.push({ startMs: cursor, endMs: span.endMs });
  }
  return out;
}
