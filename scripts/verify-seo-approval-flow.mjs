#!/usr/bin/env node
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL || "screenshot-test@wrazyos.com";
const PASSWORD = process.env.E2E_PASSWORD || "TestPass123!";
const REVIEW_UI = process.env.REVIEW_UI === "1";

const approval = (id, title, campaignId, index) => ({
  id,
  client_id: "client-a",
  work_item_id: null,
  action_type: "opportunity_work",
  destination: "seo-os-campaign",
  payload: {
    title,
    campaign_id: campaignId,
    opportunity_id: `opportunity-${index}`,
    message: `${title}. Search Console evidence supports reviewing this next.`,
    evidence: index === 1 ? "Page 2 query cluster has meaningful impressions and weak click-through." : "Recent content decay is concentrated on a high-value service page.",
    source: "Search Console · latest 28 days vs prior 28 days",
    impact: index === 1 ? "high" : "medium",
    confidence: "high",
    effort: index === 1 ? "low" : "medium",
    opportunity_type: index === 1 ? "striking_distance" : "content_decay",
    recommended_capability_id: index === 1 ? "content.revive" : "diagnose.local-audit",
    on_approval: "Starts a specialist workflow and returns a reviewable handoff. No publishing happens from this approval.",
  },
  payload_hash: `hash-${index}`,
  status: "pending",
  expires_at: "2099-01-01T00:00:00.000Z",
  expired: false,
  decided_by: null,
  decided_at: null,
  created_at: "2026-08-10T08:00:00.000Z",
  updated_at: "2026-08-10T08:00:00.000Z",
  external_result: {},
  client: { id: "client-a", name: "Northstar Dental", domain: "northstar.example" },
});

const first = approval("approval-a", "Refresh the service page that is losing traffic", "campaign-a", 1);
const second = approval("approval-b", "Improve the page-two implant query cluster", "campaign-b", 2);

const controlPlane = {
  today: [
    { id: first.id, clientId: "client-a", clientName: "Northstar Dental", title: first.payload.title, reason: first.payload.message, state: "waiting_approval", priority: 10, kind: "approval", approval: { actionType: first.action_type, destination: first.destination, payload: first.payload, payloadHash: first.payload_hash } },
    { id: second.id, clientId: "client-a", clientName: "Northstar Dental", title: second.payload.title, reason: second.payload.message, state: "waiting_approval", priority: 10, kind: "approval", approval: { actionType: second.action_type, destination: second.destination, payload: second.payload, payloadHash: second.payload_hash } },
  ],
  clients: [],
  prospects: [],
  reports: [],
  operations: { opportunities: [], content: [], reviews: [], ctrTests: [], knowledge: [], routing: [] },
  counts: { attention: 2, approvals: 2, clients: 1, prospects: 0, reports: 0, reviews: 0, ctrTests: 0, knowledge: 0 },
  generatedAt: Date.now(),
  agentActivity: [],
};

const approvalsResponse = {
  delivery_mode: "dry_run",
  approvals: [
    { ...first, context: { campaign: { id: "campaign-a", title: "Northstar Dental research sweep", objective: "Find the highest-leverage service-page wins.", status: "review", summary: "Findings ready for review.", findings_path: "clients/northstar/campaigns/campaign-a/findings.md", synthesis_run_id: "run-a", started_at: "2026-08-10T07:00:00.000Z", finished_at: "2026-08-10T07:30:00.000Z" }, opportunity: { id: "opportunity-1", title: first.payload.title, opportunity_type: "striking_distance", priority: 80, impact: "high", confidence: "high", effort: "low", status: "open", evidence: { detail: first.payload.evidence }, recommended_capability_id: "content.revive", created_at: first.created_at, updated_at: first.created_at }, run: { id: "run-a", capability_id: "diagnose.baseline", status: "complete", summary: "Found 4 evidence-backed opportunities.", started_at: "2026-08-10T07:00:00.000Z", finished_at: "2026-08-10T07:30:00.000Z" }, artifacts: [{ path: "clients/northstar/campaigns/campaign-a/findings.md", name: "findings.md", kind: "doc", source: "local-seo" }] } },
    { ...second, context: { campaign: { id: "campaign-b", title: "Northstar Dental query sweep", objective: "Find ranking terms close to page one.", status: "review", summary: "Findings ready for review.", findings_path: "clients/northstar/campaigns/campaign-b/findings.md", synthesis_run_id: "run-b", started_at: "2026-08-10T06:00:00.000Z", finished_at: "2026-08-10T06:25:00.000Z" }, opportunity: { id: "opportunity-2", title: second.payload.title, opportunity_type: "content_decay", priority: 70, impact: "medium", confidence: "high", effort: "medium", status: "open", evidence: { detail: second.payload.evidence }, recommended_capability_id: "diagnose.local-audit", created_at: second.created_at, updated_at: second.created_at }, run: { id: "run-b", capability_id: "diagnose.baseline", status: "complete", summary: "Found 3 evidence-backed opportunities.", started_at: "2026-08-10T06:00:00.000Z", finished_at: "2026-08-10T06:25:00.000Z" }, artifacts: [{ path: "clients/northstar/campaigns/campaign-b/findings.md", name: "findings.md", kind: "doc", source: "local-seo" }] } },
  ],
};

async function dismissGuide(page) {
  const close = page.getByRole("button", { name: "Close page guide" });
  if (await close.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
    await close.click({ force: true });
    await page.waitForTimeout(250);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const check = (label, condition) => {
    console.log(`  [${condition ? "PASS" : "FAIL"}] ${label}`);
    if (!condition) throw new Error(label);
  };

  try {
    await page.goto(`${BASE}/login?redirect=%2Fseo%3Fsub%3Dtoday`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15000 });
    await page.keyboard.press("Escape");

    await page.route("**/api/seo/control-plane**", async (route) => {
      if (route.request().method() === "GET") await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(controlPlane) });
      else await route.continue();
    });
    await page.goto(`${BASE}/seo?sub=today`, { waitUntil: "domcontentloaded" });
    await dismissGuide(page);
    await page.getByRole("button", { name: "Review" }).first().click();
    await page.getByTestId("seo-approval-dialog").waitFor();
    await dismissGuide(page);
    check("Best Next Action opens the approval navigator", await page.getByTestId("seo-approval-dialog").isVisible());
    check("first approval is shown without a decision", (await page.getByTestId("seo-approval-counter").last().textContent())?.includes("1 / 2") === true);
    await page.getByTestId("seo-approval-next").click();
    await page.waitForTimeout(350);
    check("next moves to the following approval", (await page.getByTestId("seo-approval-counter").last().textContent())?.includes("2 / 2") === true && (await page.getByRole("heading", { name: /Improve the page-two implant query cluster/ }).last().isVisible()));
    await page.getByTestId("seo-approval-previous").click();
    await page.waitForTimeout(350);
    check("previous returns to the first approval", (await page.getByTestId("seo-approval-counter").last().textContent())?.includes("1 / 2") === true);
    check("sweep audit link carries the campaign id", (await page.getByTestId("seo-opportunity-audit-link").getAttribute("href")) === "/seo-os/campaigns/campaign-a");
    check("approval record link carries the approval id", (await page.getByTestId("seo-approval-record-link").getAttribute("href")) === "/seo-os/approvals?approvalId=approval-a");
    if (REVIEW_UI) {
      await page.screenshot({ path: "/tmp/seo-approval-dialog-desktop.png", fullPage: false });
      const dialogAudit = await page.evaluate(() => ({
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        badGridOverlays: [...document.querySelectorAll("[class*='grid-bg'], [class*='noise'], [class*='section-grid']")].filter((element) => getComputedStyle(element).position === "absolute" && Number.parseInt(getComputedStyle(element).zIndex, 10) >= 10).length,
        dialogVisible: Boolean(document.querySelector("[data-testid='seo-approval-dialog']")),
      }));
      check("desktop approval view has no horizontal overflow", !dialogAudit.horizontalOverflow);
      check("desktop approval view has no high-z overlay", dialogAudit.badGridOverlays === 0);
      check("desktop approval dialog remains visible", dialogAudit.dialogVisible);
    }

    await page.route("**/api/seo-os/approvals**", async (route) => {
      if (route.request().method() === "GET") await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(approvalsResponse) });
      else await route.continue();
    });
    await page.goto(`${BASE}/seo-os/approvals?approvalId=approval-a`, { waitUntil: "domcontentloaded" });
    await dismissGuide(page);
    await page.getByTestId("seo-approval-detail-drawer").waitFor();
    check("approval deep link opens the side drawer", await page.getByTestId("seo-approval-detail-drawer").isVisible());
    check("drawer shows sweep evidence", (await page.getByText("Evidence from the opportunity sweep").isVisible()) && (await page.getByRole("button", { name: /findings\.md/ }).isVisible()));
    await page.getByRole("button", { name: /findings\.md/ }).click();
    check("evidence file opens above the drawer", await page.locator('button[title="Close (Esc)"]').isVisible());
    await page.locator('button[title="Close (Esc)"]').click();
    check("drawer shows source run context", (await page.getByText("Source run").isVisible()) && (await page.getByText("run-a").isVisible()));
    check("drawer exposes full campaign audit", (await page.getByText("Open the full sweep audit").isVisible()));
    if (REVIEW_UI) await page.screenshot({ path: "/tmp/seo-approval-drawer-desktop.png", fullPage: false });
    await page.getByRole("button", { name: "Next approval" }).last().click();
    check("drawer navigation moves between approval records", (await page.getByTestId("seo-approval-detail-drawer").getByRole("heading", { name: /Review SEO opportunity: Improve the page-two implant query cluster/ }).isVisible()));

    if (REVIEW_UI) {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${BASE}/seo?sub=today`, { waitUntil: "domcontentloaded" });
      await dismissGuide(page);
      await page.getByRole("button", { name: "Review" }).first().click();
      await page.getByTestId("seo-approval-dialog").waitFor();
      await dismissGuide(page);
      await page.screenshot({ path: "/tmp/seo-approval-dialog-mobile.png", fullPage: false });
      const mobileDialogAudit = await page.evaluate(() => ({
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        dialogWidth: document.querySelector("[data-testid='seo-approval-dialog']")?.getBoundingClientRect().width || 0,
      }));
      console.log(`  [INFO] mobile dialog geometry :: ${JSON.stringify(mobileDialogAudit)}`);
      check("mobile approval view has no horizontal overflow", !mobileDialogAudit.horizontalOverflow);
      check("mobile approval dialog fits the viewport", mobileDialogAudit.dialogWidth <= 375);

      await page.goto(`${BASE}/seo-os/approvals?approvalId=approval-a`, { waitUntil: "domcontentloaded" });
      await dismissGuide(page);
      await page.getByTestId("seo-approval-detail-drawer").waitFor();
      await page.screenshot({ path: "/tmp/seo-approval-drawer-mobile.png", fullPage: false });
      const mobileDrawerAudit = await page.evaluate(() => ({
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        drawerWidth: document.querySelector("[data-testid='seo-approval-detail-drawer'] aside")?.getBoundingClientRect().width || 0,
      }));
      check("mobile approval drawer has no horizontal overflow", !mobileDrawerAudit.horizontalOverflow);
      check("mobile approval drawer uses the full narrow viewport", mobileDrawerAudit.drawerWidth <= 375);
    }

    console.log(`SEO-APPROVAL-FLOW-RESULT pass=${REVIEW_UI ? 19 : 12} fail=0`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
