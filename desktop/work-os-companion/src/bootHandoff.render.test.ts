import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BOOT_STAGE_COPY, BootOverlay } from "./BootHandoff";

describe("boot handoff overlay", () => {
  // While loading: the overlay IS the First Light surface; children are absent.
  it("loading renders the First Light surface without children", () => {
    const markup = renderToStaticMarkup(createElement(BootOverlay, { surface: "data_loading" }, createElement("div", { id: "content" })));
    expect(markup).toContain('class="loading"'); // .loading shell reused
    expect(markup).toContain("Getting your day ready");
    expect(markup).toContain('role="status"'); // stage line announces
    expect(markup).toContain(BOOT_STAGE_COPY.data_loading);
    expect(markup).toContain("loading-bench"); // Task 1's Bench
    expect(markup).not.toContain('id="content"');
  });

  // The vault phase states its own truthful line.
  it("the vault phase reads the saved-session stage line", () => {
    const markup = renderToStaticMarkup(createElement(BootOverlay, { surface: "vault_loading" }, createElement("div", { id: "content" })));
    expect(markup).toContain(BOOT_STAGE_COPY.vault_loading);
  });

  // Content on first render (no prior loading — e.g. the admin fixture): children only.
  it("content-first renders children with no exit machinery", () => {
    const markup = renderToStaticMarkup(createElement(BootOverlay, { surface: "workspace" }, createElement("div", { id: "content" })));
    expect(markup).toContain('id="content"');
    expect(markup).not.toContain("boot-exit");
  });

  // The static render pins the exit CLASS names the client state machine applies;
  // the machine itself (landing → exiting → done) is reviewed via the preview.
  it("declares the exit classes and reduced-motion fade in markup source", () => {
    const source = readFileSync(new URL("./BootHandoff.tsx", import.meta.url), "utf8");
    expect(source).toContain("boot-exit");
    expect(source).toContain("boot-exit-reduced");
    expect(source).toContain("boot-cover");
  });
});
