import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server.js";
import { proxy } from "../src/proxy.ts";

test("anonymous visitors can follow the landing page legal links without signing in", async () => {
  for (const route of ["/", "/privacy", "/terms", "/docs/agent-api", "/docs/agent-api/llms.txt", "/landing/task-workflow.mp4", "/landing/task-workflow.vtt"]) {
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

test("the Work OS employee site is public without opening the workspace", async () => {
  for (const route of [
    "/work-os",
    "/work-os/downloads",
    "/work-os/tutorials",
    "/work-os/tutorials/eod-draft",
    "/work-os/welcome",
    "/work-os/welcome/downloads",
    "/work-os/welcome/tutorials",
    "/work-os/welcome/tutorials/eod-draft",
    "/downloads/work-os/windows",
    "/downloads/work-os/macos/checksums",
    "/site/work-os/tutorials/eod-draft.mp4",
    "/fonts/InterVariable.woff2",
  ]) {
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 200, `${route} must be public`);
  }
  for (const route of [
    "/work-os/workspace",
    "/work-os/today",
    "/work-os/review",
    "/api/work-os/desktop/updates/windows/x86_64/1.0.0",
    "/work-os/welcome/internal",
  ]) {
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 307, `${route} must require sign-in`);
  }
});

test("the site navigation links to the public Work OS landing", () => {
  const source = readFileSync(new URL("../src/modules/work-os/marketing/site.ts", import.meta.url), "utf8");
  assert.match(source, /home: "\/work-os"/);
  assert.match(source, /label: "Overview", href: "\/work-os"/);
  assert.doesNotMatch(source, /href: "\/work-os\/welcome"/);
});
