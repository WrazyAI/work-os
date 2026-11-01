import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { proxy } from "../src/proxy.ts";

test("anonymous visitors can follow the landing page legal links without signing in", async () => {
  for (const route of ["/", "/privacy", "/terms", "/docs/agent-api", "/landing/task-workflow.mp4", "/landing/task-workflow.vtt"]) {
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 200, `${route} must remain public`);
    assert.equal(response.headers.get("location"), null);
  }
});

test("making legal pages public does not open the dashboard or task APIs", async () => {
  for (const route of ["/kanban", "/seo-os", "/api/work-os/tasks", "/landing/private.mp4", "/privacy/internal"]) {
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 307, `${route} must still require sign-in`);
    assert.equal(new URL(response.headers.get("location")!).pathname, "/login");
  }
});
