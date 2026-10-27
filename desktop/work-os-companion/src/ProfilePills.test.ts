import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ItemPillGroup, ProviderAccountPills } from "./ProfilePills";
import type { ProfileItemKind, ProviderAccounts, WorkProfileItem } from "./types";

const noop = () => undefined;

const item = (id: string, kind: ProfileItemKind, label: string): WorkProfileItem => ({ id, kind, label, source: "suggested" });
const items = [item("r1", "responsibility", "Design and implement software"), item("r2", "responsibility", "Maintain technical quality")];
const options = [
  ...items,
  item("r3", "responsibility", "Diagnose defects and incidents"),
  item("d1", "deliverable", "Technical documents"),
];

describe("ItemPillGroup", () => {
  const markup = renderToStaticMarkup(createElement(ItemPillGroup, {
    kind: "responsibility",
    legend: "Responsibilities",
    legendId: "preview-legend",
    items,
    options,
    onChange: noop,
  }));

  it("renders picked signals as pills with their own remove control", () => {
    expect(markup).toContain("Design and implement software");
    expect(markup).toContain('aria-label="Remove Design and implement software"');
    expect(markup.match(/class="profile-pill"/g) ?? []).toHaveLength(2);
  });

  it("offers only unpicked scope suggestions as add chips", () => {
    expect(markup).toContain('aria-label="Add Diagnose defects and incidents"');
    expect(markup).not.toContain('aria-label="Add Design and implement software"');
    expect(markup).not.toContain("Technical documents");
  });

  it("keeps one bounded way to add something the catalog does not list", () => {
    expect(markup).toContain("Add your own");
    expect(markup).not.toContain('placeholder="Add your own"');
  });

  it("names the group through its legend", () => {
    expect(markup).toContain('id="preview-legend"');
    expect(markup).toContain("Responsibilities");
  });
});

describe("ItemPillGroup empty state", () => {
  const markup = renderToStaticMarkup(createElement(ItemPillGroup, {
    kind: "responsibility",
    legend: "Responsibilities",
    legendId: "preview-legend",
    items: [],
    options,
    onChange: noop,
  }));

  it("says nothing is picked yet instead of showing an empty row", () => {
    expect(markup).toContain("Nothing picked yet.");
    expect(markup).not.toContain('class="profile-pill"');
  });
});

const accounts: ProviderAccounts = {
  nifty: { mapped: true, email: "jamie@wrazy.com" },
  worktivity: { mapped: true, email: "jamie@wrazy.com" },
  github: {
    accounts: [
      { login: "jamie-mensah", id: "1", verified: true, bot: false },
      { login: "wrazy-ci[bot]", id: "2", verified: false, bot: true },
    ],
  },
};

describe("ProviderAccountPills", () => {
  const markup = renderToStaticMarkup(createElement(ProviderAccountPills, { accounts }));

  it("names each mapped provider with the identifier the workspace recorded", () => {
    expect(markup).toContain("Worktivity");
    expect(markup).toContain("jamie@wrazy.com");
    expect(markup).toContain("GitHub");
    expect(markup).toContain("jamie-mensah");
    expect(markup).toContain("Connected accounts");
  });

  it("hides the retired provider once tasks are native", () => {
    expect(markup.match(/jamie@wrazy\.com/g)?.length).toBe(1);
  });

  it("keeps the workspace as the authority over mappings", () => {
    expect(markup).toContain("Mapped to you by your workspace");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<button");
  });

  it("marks an unverified account as pending instead of connected", () => {
    expect(markup).toContain("Pending");
    expect(markup).toContain("wrazy-ci[bot]");
  });

  it("states an honest empty account group", () => {
    const empty = renderToStaticMarkup(createElement(ProviderAccountPills, {
      accounts: { nifty: { mapped: false, email: null }, worktivity: { mapped: false, email: null }, github: { accounts: [] } },
    }));
    expect(empty).toContain("No evidence accounts are mapped to you yet.");
    expect(empty).toContain("Mapped to you by your workspace");
  });

  it("shows a mapped provider without an identifier as the bare provider", () => {
    const bare = renderToStaticMarkup(createElement(ProviderAccountPills, {
      accounts: { nifty: { mapped: false, email: null }, worktivity: { mapped: true, email: null }, github: { accounts: [] } },
    }));
    expect(bare).toContain("Worktivity");
    expect(bare).not.toContain('class="profile-account-id"');
  });
});
