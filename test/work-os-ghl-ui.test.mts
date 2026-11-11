import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const evidence = readFileSync(new URL("../src/modules/work-os/admin/AdminEvidence.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/modules/work-os/admin/AdminSettings.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../src/modules/work-os/admin/GhlEvidenceDetail.tsx", import.meta.url), "utf8");

test("the existing Evidence surface treats GoHighLevel as a real source", () => {
  assert.equal(evidence.includes('{ value: "ghl", label: "GoHighLevel" }'), true);
  assert.equal(evidence.includes("GHL — coming soon"), false);
  assert.equal(evidence.includes("Read-only PIT polling"), true);
  assert.equal(evidence.includes("Shared, automated and assigned-only records stay context"), true);
  assert.equal(evidence.includes("GhlEvidenceDetail"), true);
});

test("the admin settings expose GHL without claiming it is already connected", () => {
  assert.equal(settings.includes("GHL — coming soon"), false);
  assert.equal(settings.includes("Read-only PIT polling"), true);
  assert.equal(settings.includes('{ value: "ghl", label: "GoHighLevel" }'), true);
});

test("the detail surface keeps content transient, scrollable and keyboard reachable", () => {
  assert.equal(detail.includes("<pre"), true);
  assert.equal(detail.includes("overflow-auto"), true);
  assert.equal(detail.includes("useEffect"), false, "state is reset by a keyed remount, not an effect");
  assert.equal(evidence.includes("key={selected.ghl?.eventId"), true);
  assert.equal(detail.includes("<Button"), true);
});

test("SOD shows a bounded GHL disclosure without claiming completion", () => {
  const planBuilder = readFileSync(new URL("../src/modules/work-os/employee/EmployeePlanBuilder.tsx", import.meta.url), "utf8");
  assert.equal(planBuilder.includes("GHL evidence context"), true);
  assert.equal(planBuilder.includes("does not prove completion, sales, or effort"), true);
  assert.equal(planBuilder.includes("ghlEvidence"), true);
});

test("manager Overview and Insights show a GHL aggregate source", () => {
  const overview = readFileSync(new URL("../src/modules/work-os/admin/AdminOverview.tsx", import.meta.url), "utf8");
  const insights = readFileSync(new URL("../src/modules/work-os/admin/AdminInsights.tsx", import.meta.url), "utf8");
  assert.equal(overview.includes('label="GoHighLevel"'), true);
  assert.equal(overview.includes("ghlPerformedToday"), true);
  assert.equal(insights.includes('label="GHL evidence"'), true);
  assert.equal(insights.includes("data.ghl.contextTotal"), true);
});
