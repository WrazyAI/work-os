import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkArrangementFields } from "../src/modules/work-os/WorkArrangementFields";
import { ArrangementReview } from "../src/modules/work-os/ArrangementReview";

test("flexible setup renders workdays but no shift or hours-target inputs", () => {
  const html = renderToStaticMarkup(createElement(WorkArrangementFields, { value: { arrangement: "flexible", daysOfWeek: [1, 5], shiftStart: null, shiftEnd: null, breaks: [] }, onChange() {} }));
  assert.match(html, /Contractor \/ flexible hours/);
  assert.match(html, /Working days/);
  assert.doesNotMatch(html, /type="time"|hours target|daily hours/i);
});
test("only a submitted proposal offers approval, and pending review never claims an official shift", () => {
  const proposal = { status: "submitted", revision: 2, submittedAt: "2026-11-13T10:00:00Z", timezone: "UTC", schedule: { arrangement: "flexible" as const, daysOfWeek: [1], shiftStart: null, shiftEnd: null, breaks: [] }, note: null, canReview: true };
  const html = renderToStaticMarkup(createElement(ArrangementReview, { proposal, onReview: async () => ({ status: "approved" }) }));
  assert.match(html, /Approve arrangement/);
  assert.match(html, /Request changes/);
  assert.match(html, /Pending administrator review/);
  const readonly = renderToStaticMarkup(createElement(ArrangementReview, { proposal: { ...proposal, canReview: false }, onReview: async () => ({ status: "approved" }) }));
  assert.doesNotMatch(readonly, /Approve arrangement/);
});
test("scheduled setup preserves shift controls and old payloads default to scheduled", () => {
  const html = renderToStaticMarkup(createElement(WorkArrangementFields, { value: { daysOfWeek: [1], shiftStart: "09:00", shiftEnd: "17:00", breaks: [] }, onChange() {} }));
  assert.match(html, /Shift starts/);
  assert.match(html, /Shift ends/);
  assert.match(html, /type="time"/);
});
