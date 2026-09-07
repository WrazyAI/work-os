import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatErrorFallback, ChatSectionBoundary } from "./ErrorBoundary";

describe("ChatSectionBoundary", () => {
  it("trips into the failed state on a render error", () => {
    const next = ChatSectionBoundary.getDerivedStateFromError(new Error("boom"));
    expect(next).toEqual({ failed: true });
  });

  it("renders an inline, retryable fallback instead of blank content", () => {
    const markup = renderToStaticMarkup(createElement(ChatErrorFallback, { onRetry: () => undefined }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("couldn&#x27;t render");
    expect(markup).toContain("Try again");
  });
});
