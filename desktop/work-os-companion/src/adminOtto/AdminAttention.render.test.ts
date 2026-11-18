import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminAttentionBubble } from "./AdminAttentionBubble";
import { AdminAttentionCard } from "./AdminAttentionCard";
import type { AdminAttentionItem } from "./attention";

const eod: AdminAttentionItem = {
  id: "eod:fixture", kind: "eod_submitted", count: 1,
  title: "EOD report submitted", body: "Maya Chen's report is waiting for your review.",
  section: "review", personId: "person-1", at: "2026-11-18T17:04:00.000Z",
};
const recap: AdminAttentionItem = {
  id: "recap:fixture", kind: "recap_reviewed", count: 2,
  title: "Reviewed recaps are ready", body: "2 recaps are waiting in the administration inbox.",
  section: "recaps", personId: null, at: "2026-11-18T17:05:00.000Z",
};
const noop = () => undefined;

describe("AdminAttentionBubble", () => {
  it("names the EOD arrival and its review destination", () => {
    const markup = renderToStaticMarkup(createElement(AdminAttentionBubble, {
      item: eod, onOpen: noop, onAction: noop, onDismiss: noop,
    }));
    expect(markup).toContain("EOD report submitted");
    expect(markup).toContain("Maya Chen&#x27;s report is waiting for your review.");
    expect(markup).toContain("Review reports");
    expect(markup).toContain("avatar-admin-attention-bubble");
    expect(markup).toContain('aria-label="Dismiss admin reminder"');
  });

  it("names the reviewed recap group and its inbox destination", () => {
    const markup = renderToStaticMarkup(createElement(AdminAttentionBubble, {
      item: recap, onOpen: noop, onAction: noop, onDismiss: noop,
    }));
    expect(markup).toContain("Reviewed recaps are ready");
    expect(markup).toContain("View recaps");
    expect(markup).toContain("is-recap_reviewed");
  });
});

describe("AdminAttentionCard", () => {
  it("renders the grounded arrival as a quiet administration card", () => {
    const markup = renderToStaticMarkup(createElement(AdminAttentionCard, {
      item: eod, onAction: noop, onDismiss: noop,
    }));
    expect(markup).toContain("admin-otto-attention");
    expect(markup).toContain("EOD report submitted");
    expect(markup).toContain("Review reports");
    expect(markup).toContain("Dismiss admin reminder");
  });
});
