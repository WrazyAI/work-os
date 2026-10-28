// Local-only rendered smoke: every API is intercepted; no credential/provider is used.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.env.OTTO_PREVIEW_URL ?? "http://127.0.0.1:1438";
const output = process.env.OTTO_PREVIEW_OUTPUT ?? "/tmp/opencode/task8-preview";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, width, height] of [["wide", 1440, 900], ["narrow", 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requests = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/")) { requests.push(url.pathname); return route.abort(); }
      if (url.origin !== new URL(base).origin) return route.abort();
      return route.continue();
    });
    await page.goto(`${base}/?preview-admin`);
    const trigger = page.getByRole("button", { name: "New chat", exact: true });
    await trigger.click();
    await page.getByRole("textbox", { name: "Ask about the team" }).fill("What is unfinished?");
    await page.getByRole("button", { name: "Ask Otto", exact: true }).click();
    await page.getByText("This preview answers locally; no admin request leaves the fixture.").waitFor();
    await page.screenshot({ path: `${output}/${name}-chat.png` });
    const dialog = page.getByRole("dialog");
    const bounds = await dialog.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert(bounds.y >= 0 && bounds.y + bounds.height <= height, "dialog stays inside the vertical viewport");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert(await trigger.evaluate((node) => node === document.activeElement), "focus returns to New chat");
    assert.deepEqual(requests, [], "fixture never requests an admin endpoint");
    assert.deepEqual(errors, []);
    await page.goto(`${base}/?offline&token=fixture-only`);
    await page.getByRole("button", { name: "New chat", exact: true }).waitFor();
    assert.deepEqual(requests, [], "offline initial boot stays network-silent even with a token parameter");
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let contexts = 0;
  let interruptNext = false;
  let threadLoads = 0;
  let failHydration;
  const hydrationGate = new Promise((done) => { failHydration = done; });
  const chatRequests = [];
  const paths = [];
  await page.addInitScript(() => localStorage.setItem("work-os.workspace-mode", "employee"));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) {
      return url.origin === new URL(base).origin ? route.continue() : route.abort();
    }
    paths.push(url.pathname);
    let status = 200;
    let body = {};
    if (url.pathname === "/api/work-os/session") {
      body = { userId: "fixture-admin", organizationId: "fixture-org", role: "admin", personId: null,
        featureFlags: { employee_companion: true, desktop_companion: true } };
    } else if (url.pathname.endsWith("/otto/context")) {
      contexts++;
      status = contexts === 1 || contexts === 3 ? 503 : 200;
      body = { schemaVersion: 1, scope: { userId: "fixture-admin", organizationId: "fixture-org", mode: "admin" },
        personId: null, voiceAvailable: false, transcriptionAvailable: false };
    } else if (url.pathname.endsWith("/otto/chat")) {
      if (route.request().method() === "GET") {
        if (++threadLoads === 1) {
          await hydrationGate;
          return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Thread hydration unavailable" }) });
        }
        body = { schemaVersion: 1, conversationId: "fixture-thread", contextVersion: 1, result: null, resultStatus: "ready",
          turns: [{ turnId: "fixture-turn", role: "assistant", text: "Local mocked answer", createdAt: new Date().toISOString() }] };
      } else {
        chatRequests.push(route.request().postDataJSON());
        if (interruptNext) { interruptNext = false; return route.abort(); }
        body = { schemaVersion: 1, conversationId: "fixture-thread", turnId: `fixture-turn-${chatRequests.length}`,
          reply: chatRequests.length === 1 ? "Local mocked answer" : "Recovered known conversation", result: null, contextVersion: 1 };
      }
    } else if (url.pathname.endsWith("/otto/inbox")) {
      body = { schemaVersion: 1, items: [], total: 0, nextCursor: null, asOf: new Date().toISOString(), coverage: [], unread: 0, catchupPending: false };
    } else if (url.pathname.endsWith("/otto/inbox/claim")) {
      body = { schemaVersion: 1, lease: null };
    } else {
      status = 503;
      body = { error: "Fixture intentionally omits unrelated workspace data." };
    }
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${base}/?token=fixture-only`);
  await page.getByText("Admin Otto could not load its administration context. Retry from New chat; the workspace record remains available.", { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/context-failed.png` });
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("textbox", { name: "Ask about the team" }).fill("Read team work");
  await page.getByRole("button", { name: "Ask Otto", exact: true }).click();
  await page.getByText("Local mocked answer", { exact: true }).waitFor();
  assert.equal(await page.getByText("No scheduled shift", { exact: true }).count(), 0, "unmapped admin gets no employee attendance reminder");
  assert.equal(contexts, 2, "New chat executes the context retry");
  assert(!paths.some((path) => /\/me\/(day|onboarding)$/.test(path)), "unmapped saved-employee admin never bootstraps personal data");
  await page.screenshot({ path: `${output}/context-recovered.png` });
  interruptNext = true;
  await page.getByRole("textbox", { name: "Ask about the team" }).fill("Keep this follow-up");
  await page.getByRole("button", { name: "Ask Otto", exact: true }).click();
  await page.getByRole("dialog").getByRole("alert").waitFor();
  await page.evaluate(async () => {
    // Vite HMR can give the app's singleton a timestamped module URL. Import
    // that exact URL rather than accidentally constructing a second client.
    const main = await (await fetch("/src/main.tsx")).text();
    const moduleUrl = main.match(/from "([^"]*\/src\/queryClient\.ts[^\"]*)"/)[1];
    const { workOsQueryClient } = await import(moduleUrl);
    await workOsQueryClient.refetchQueries({ queryKey: ["work-os", "admin", "otto"] });
  });
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("textbox", { name: "Ask about the team" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Ask about the team" }).inputValue(), "Keep this follow-up");
  await page.getByRole("status").filter({ hasText: "Loading conversation…" }).waitFor();
  assert(await page.getByRole("button", { name: "Loading…", exact: true }).isDisabled());
  await page.getByRole("textbox", { name: "Ask about the team" }).press("Enter");
  assert.equal(chatRequests.length, 2, "Enter cannot submit before known-thread hydration");
  failHydration();
  await page.getByRole("button", { name: "Retry loading conversation", exact: true }).waitFor();
  assert(await page.getByRole("button", { name: "Ask Otto", exact: true }).isDisabled());
  await page.screenshot({ path: `${output}/hydration-failed.png` });
  await page.getByRole("button", { name: "Retry loading conversation", exact: true }).click();
  await page.getByRole("button", { name: "Ask Otto", exact: true }).click();
  await page.getByText("Recovered known conversation", { exact: true }).waitFor();
  assert.equal(chatRequests.length, 3);
  assert.equal(chatRequests[1].conversationId, "fixture-thread");
  assert.equal(chatRequests[2].conversationId, "fixture-thread", "context recovery preserves the known conversation id");
  assert.equal(chatRequests[2].requestId, chatRequests[1].requestId, "context recovery preserves the indeterminate request id");
  await page.goto(`${base}/?window=avatar&token=fixture-only`);
  await page.evaluate(async () => {
    const { secureState } = await import("/src/vault.ts");
    await secureState.session();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  assert(!paths.some((path) => /\/me\/(day|onboarding)$/.test(path)), "unmapped avatar never bootstraps personal data");
  // Exercise the real employee notification provider, not a local sentinel Set.
  await page.evaluate(async () => {
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: { createRoot } } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { NotificationProvider, useNotifications } = await import("/src/NotificationFlyouts.tsx");
    const { createOttoModeController } = await import("/src/adminOtto/mode.ts");
    const { clearAdminOttoSurface } = await import("/src/adminOtto/modeSurface.ts");
    const host = document.createElement("div"); host.id = "prompt-preservation-runtime"; document.body.append(host);
    function ModeBoundaryProbe() {
      const notifications = useNotifications();
      const [surface, setSurface] = React.useState({ entryOpen: true, conversationId: "thread" });
      const [controller] = React.useState(() => {
        const context = (mode) => ({ scope: { userId: "fixture", organizationId: "org", mode }, personId: "person", voiceAvailable: false, transcriptionAvailable: false });
        return createOttoModeController({ initialContext: context("admin"), adminContext: context("admin"), employeeContext: context("employee"),
          clearResults: () => setSurface(clearAdminOttoSurface()),
        });
      });
      React.useEffect(() => { notifications.persistent("personal-recap", "Your recap is ready", "Personal reminder"); }, [notifications]);
      return React.createElement("section", null,
        React.createElement("button", { onClick: () => controller.switchMode("employee") }, "Probe employee"),
        React.createElement("button", { onClick: () => controller.switchMode("admin") }, "Probe admin"),
        surface.entryOpen ? React.createElement("p", null, "Admin result before boundary") : null);
    }
    createRoot(host).render(React.createElement(NotificationProvider, null, React.createElement(ModeBoundaryProbe)));
  });
  const probe = page.locator("#prompt-preservation-runtime");
  await probe.getByText("Your recap is ready", { exact: true }).waitFor();
  await probe.getByRole("button", { name: "Probe employee", exact: true }).click();
  assert.equal(await probe.getByText("Admin result before boundary", { exact: true }).count(), 0);
  assert.equal(await probe.getByText("Your recap is ready", { exact: true }).count(), 1);
  await probe.getByRole("button", { name: "Probe admin", exact: true }).click();
  assert.equal(await probe.getByText("Your recap is ready", { exact: true }).count(), 1);
  await page.close();
  console.log(JSON.stringify({ checks: "wide/narrow fixture chat, focus return, offline boot, failed-context retry, unmapped saved-employee boot", output }));
} finally {
  await browser.close();
}
