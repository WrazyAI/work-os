import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { proxy } from "../src/proxy.ts";

test("public Work OS site routes are reachable anonymously", async () => {
  for (const route of [
    "/work-os/welcome",
    "/work-os/welcome/downloads",
    "/work-os/welcome/tutorials",
    "/work-os/welcome/tutorials/eod-draft",
  ]) {
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 200, `${route} must be public`);
    assert.equal(response.headers.get("location"), null, `${route} must not redirect`);
  }
});

test("the public site does not open the employee workspace", async () => {
  for (const route of [
    "/work-os/today",
    "/work-os/review",
    "/api/work-os/me/day",
    "/work-os/welcome/internal",
  ]) {
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 307, `${route} must require sign-in`);
    assert.equal(new URL(response.headers.get("location")!).pathname, "/login");
  }
});
