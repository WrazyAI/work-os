import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import PayrollPage from "./PayrollPage";
import { seedPayrollPreview } from "./preview";

const SESSION = { organizationId: "org-preview", userId: "user-preview" };

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedPayrollPreview(client, SESSION, false);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client },
      createElement(PayrollPage, { ...SESSION }),),
  );
}

describe("native payroll record list", () => {
  it("opens on Records and gives every existing audit a visible, labelled action", () => {
    const markup = render();
    expect(markup).toContain('aria-pressed="true">Records');
    expect((markup.match(/>Open review</g) ?? []).length).toBe(3);
    expect(markup.match(/class="payroll-open-row"/g) ?? []).toHaveLength(3);
    expect(markup).toContain('aria-label="Open Ada Okafor payroll review"');
    expect(markup).toContain('aria-label="Open Luis Moreno payroll review"');
    expect(markup).toContain('aria-label="Open Mei Tanaka payroll review"');
  });
});
