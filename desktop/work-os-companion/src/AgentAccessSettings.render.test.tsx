import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { AgentAccessSettings, AgentAccessSummary } from "./AgentAccessSettings";

function render(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, node));
}

describe("agent access inline views", () => {
  it("renders employee management inline with the user guide", () => {
    const markup = render(createElement(AgentAccessSettings, {
      surface: "employee",
      apiBase: "https://app.wrazyos.com",
    }));
    expect(markup).toContain("New token");
    expect(markup).toContain("Token name");
    expect(markup).toContain("tasks:read");
    expect(markup).toContain("Active tokens");
    expect(markup).toContain("User API guide");
    expect(markup).toContain("https://app.wrazyos.com/docs/agent-api/user");
    expect(markup).not.toContain("Admin API guide");
  });

  it("renders administrator scopes and the admin guide inline", () => {
    const markup = render(createElement(AgentAccessSettings, {
      surface: "admin",
      apiBase: "https://app.wrazyos.com",
      adminEnabled: true,
    }));
    expect(markup).toContain("people:read");
    expect(markup).toContain("Review EOD reports");
    expect(markup).toContain("Admin API guide");
    expect(markup).toContain("https://app.wrazyos.com/docs/agent-api/admin");
    expect(markup).not.toContain("User API guide");
  });

  it("keeps the feature-flag gate in the administrator view", () => {
    const markup = render(createElement(AgentAccessSettings, {
      surface: "admin",
      apiBase: "https://app.wrazyos.com",
      adminEnabled: false,
    }));
    expect(markup).toContain("Admin agent access is off");
    expect(markup).toContain("Admin API guide");
    expect(markup).not.toContain("New token");
  });

  it("keeps the summary band's manage action and guide on the employee surface", () => {
    const markup = render(createElement(AgentAccessSummary, {
      surface: "employee",
      apiBase: "app.wrazyos.com",
      onManage: () => undefined,
    }));
    expect(markup).toContain("Scoped tokens");
    expect(markup).toContain("Manage tokens");
    expect(markup).toContain("https://app.wrazyos.com/docs/agent-api/user");
  });
});
