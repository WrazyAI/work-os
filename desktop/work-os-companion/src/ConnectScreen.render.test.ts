import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectScreen } from "./App";

function screen(overrides: Partial<Parameters<typeof ConnectScreen>[0]> = {}) {
  return renderToStaticMarkup(createElement(ConnectScreen, {
    apiBase: "https://app.wrazyos.com",
    setApiBase: () => undefined,
    connecting: false,
    onConnect: () => undefined,
    onSave: async () => undefined,
    ...overrides,
  }));
}

describe("connect screen", () => {
  it("is the first-run stage's first frame, not a separate landing page", () => {
    const markup = screen();
    expect(markup).toContain('class="guided-onboarding"');
    expect(markup).toContain('data-stage="welcome"');
    expect(markup).toContain('class="onboarding-story"');
    expect(markup).toContain("story-brand");
    // The stage carries the statement; Otto carries the reasoning.
    expect(markup).toContain("Desktop companion");
    expect(markup).toContain("Connect your workspace.");
    expect(markup).toContain("Otto: I’m Otto. First, let me get you in");
    // One action and a short note, exactly like the welcome that follows it.
    expect(markup).toContain("Connect workspace");
    expect(markup).toContain("About a minute.");
    // The old landing-page furniture is gone.
    expect(markup).not.toContain("connect-steps");
    expect(markup).not.toContain("Authorize");
    expect(markup).not.toContain("connect-art");
    expect(markup).not.toContain("A calmer way to begin");
  });

  it("keeps the connect state honest in the one action", () => {
    const markup = screen({ connecting: true });
    expect(markup).toContain("Opening browser…");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("Connect workspace");
  });

  it("keeps waiting after the browser opens, and reopens the same request", () => {
    const markup = screen({ awaiting: true });
    expect(markup).toContain("Approve this device there");
    expect(markup).toContain("Waiting for approval in your browser.");
    expect(markup).toContain("Reopen browser");
    expect(markup).not.toContain("Connect workspace");
    expect(markup).not.toContain("About a minute.");
  });

  it("keeps the advanced server override reachable from the bubble", () => {
    const markup = screen();
    expect(markup).toContain("Advanced settings");
    expect(markup).toContain('id="workspace-server-url"');
    expect(markup).toContain("Save</button>");
  });

  it("renders Otto in the disconnected pose — no workspace exists yet", () => {
    const markup = screen();
    expect(markup).toContain("mascot-stage");
    expect(markup).toContain('data-workday="disconnected"');
  });
});
