import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { NotificationProvider } from "../NotificationFlyouts";
import { adminKeys, todayIso } from "./data";
import TasksPage from "./TasksPage";

const summary = { open: 245, overdue: 12, completedWeek: 7 };

function renderTasks(...pageSizes: number[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(adminKeys.people(), { people: [] });
  client.setQueryData(adminKeys.projects(), { projects: [] });
  let offset = 0;
  const pageParams: number[] = [];
  const pages = pageSizes.map((size) => {
    pageParams.push(offset);
    const tasks = Array.from({ length: size }, (_, i) => ({
      id: `task-${offset + i + 1}`,
      title: `Pagination task ${offset + i + 1}`,
      completed: false,
    }));
    offset += size;
    return { tasks, nextOffset: size === 100 ? offset : null, summary };
  });
  const filters = { filter: "open", personId: "", projectId: "", completed: "false", date: todayIso() };
  client.setQueryData(adminKeys.tasks({ ...filters, limit: "100" }), { pages, pageParams });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(NotificationProvider, null, createElement(TasksPage))));
}

describe("desktop Admin Tasks pagination", () => {
  it("renders 100 initial tasks, workload counts and an explicit continuation", () => {
    const markup = renderTasks(100);
    expect(markup.match(/data-pan-row="true"/g)).toHaveLength(100);
    expect(markup).toContain(">Show more</button>");
    expect(markup).toContain("245 open · 12 overdue · 7 completed in the last 7 days");
  });

  it("keeps earlier tasks when subsequent pages go past the old 200-row cap", () => {
    const markup = renderTasks(100, 100, 45);
    expect(markup.match(/data-pan-row="true"/g)).toHaveLength(245);
    expect(markup).toContain('aria-label="Open task Pagination task 1"');
    expect(markup).toContain('aria-label="Open task Pagination task 245"');
    expect(markup).not.toContain(">Show more</button>");
  });

  it("renders a genuine empty record without a continuation", () => {
    const markup = renderTasks(0);
    expect(markup).toContain("No tasks match these filters.");
    expect(markup).not.toContain(">Show more</button>");
  });
});
