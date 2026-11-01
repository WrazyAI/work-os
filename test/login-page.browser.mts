import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.LOGIN_TEST_URL;

test("login has accessible password reveal and working recovery destinations", { skip: !url }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url!);
    await page.getByRole("heading", { name: "Welcome back.", exact: true }).waitFor();
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("not-a-real-password");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    assert.equal(await password.getAttribute("type"), "text");
    assert.equal(await page.getByRole("button", { name: "Hide password", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    assert.equal(await password.getAttribute("type"), "password");
    assert.equal(await password.inputValue(), "not-a-real-password");
    assert.equal(await page.getByRole("link", { name: "Forgot password?" }).getAttribute("href"), "/forgot-password");
    assert.equal(await page.getByRole("link", { name: "Back to home" }).getAttribute("href"), "/");
    assert.equal(await page.getByRole("link", { name: "Privacy Policy" }).getAttribute("href"), "/privacy");
    assert.equal(await password.getAttribute("autocomplete"), "current-password");
  } finally { await browser.close(); }
});

test("pending login suppresses duplicates and rejected credentials retain inputs", { skip: !url }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let requests = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/auth/sign-in/email", async (route) => {
      requests += 1;
      assert.equal(route.request().method(), "POST");
      assert.deepEqual(route.request().postDataJSON(), { email: "invalid@example.test", password: "not-a-real-password" });
      await gate;
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Invalid email or password." }) });
    });
    await page.goto(url!);
    await page.getByLabel("Email", { exact: true }).fill("invalid@example.test");
    await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Signing in…", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Signing in…", exact: true }).isDisabled(), true);
    await page.getByLabel("Password", { exact: true }).press("Enter");
    assert.equal(requests, 1);
    release!();
    const error = page.getByRole("form", { name: "Sign in to WrazyOS" }).getByRole("alert");
    await error.waitFor();
    assert.equal(await error.textContent(), "Invalid email or password.");
    assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "invalid@example.test");
    assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), "not-a-real-password");
    assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isEnabled(), true);
  } finally { await browser.close(); }
});

test("successful sign-in keeps the established workspace destination", { skip: !url }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/api/auth/sign-in/email", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.route("**/work-os", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Authorized destination fixture</h1>" }));
    await page.goto(url!);
    await page.getByLabel("Email", { exact: true }).fill("invalid@example.test");
    await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/work-os");
    assert.equal(new URL(page.url()).pathname, "/work-os");
  } finally { await browser.close(); }
});

test("login is responsive and handles network failures without clipping", { skip: !url }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    for (const [width, height] of [[1440,900],[1024,768],[720,900],[390,844],[320,600]]) {
      await page.setViewportSize({ width, height });
      await page.goto(url!);
      await page.getByRole("heading", { name: "Welcome back.", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no overflow at ${width}px`);
      assert.ok((await page.getByRole("button", { name: "Sign in", exact: true }).boundingBox())!.height >= 44);
    }
    await page.route("**/api/auth/sign-in/email", (route) => route.abort());
    await page.getByLabel("Email", { exact: true }).fill("invalid@example.test");
    await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const error = page.getByRole("form", { name: "Sign in to WrazyOS" }).getByRole("alert");
    await error.waitFor();
    assert.match(await error.textContent() ?? "", /Network error/);
    assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), "not-a-real-password");
  } finally { await browser.close(); }
});

test("empty and malformed email submissions never reach authentication", { skip: !url }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let requests = 0;
    await page.route("**/api/auth/sign-in/email", async (route) => { requests += 1; await route.abort(); });
    await page.goto(url!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    assert.equal(requests, 0);
    await page.getByLabel("Email", { exact: true }).fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    assert.equal(requests, 0);
    assert.equal(await page.getByLabel("Email", { exact: true }).evaluate((input) => (input as HTMLInputElement).validity.typeMismatch), true);
  } finally { await browser.close(); }
});

test("long provider errors and forced dark appearance preserve readable form geometry", { skip: !url }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 600 }, colorScheme: "dark", reducedMotion: "reduce" });
    const message = `Sign-in unavailable: ${"temporary-provider-reference".repeat(12)}`;
    await page.route("**/api/auth/sign-in/email", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message }) }));
    await page.goto(url!);
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("invalid@example.test");
    await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const error = page.getByRole("form", { name: "Sign in to WrazyOS" }).getByRole("alert");
    await error.waitFor();
    assert.equal(await error.textContent(), message);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.getByRole("heading", { name: "Welcome back.", exact: true }).evaluate((h) => getComputedStyle(h).color), "rgb(24, 32, 24)");
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: "Show password", exact: true }).focus();
    const outline = await page.getByRole("button", { name: "Show password", exact: true }).evaluate((button) => getComputedStyle(button).outlineStyle);
    assert.equal(outline, "solid");
  } finally { await browser.close(); }
});

test("a JavaScript-disabled submission never puts credentials into a URL", { skip: !url }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.route("**/api/auth/sign-in/email", (route) => route.fulfill({ status: 400, contentType: "text/html", body: "Enable JavaScript to sign in." }));
    await page.route("**/login?**", (route) => route.fulfill({ status: 400, contentType: "text/html", body: "Unsafe native GET" }));
    await page.goto(url!);
    await page.getByLabel("Email", { exact: true }).fill("invalid@example.test");
    await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
    const request = page.waitForRequest((request) => request.isNavigationRequest() && request.method() !== "OPTIONS");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const submitted = await request;
    assert.equal(submitted.method(), "POST", "native fallback must not expose credentials in URL/history");
    assert.equal(new URL(submitted.url()).search, "");
    assert.equal(new URL(submitted.url()).pathname, "/api/auth/sign-in/email");
  } finally { await browser.close(); }
});

test("successful authentication stays locked while the workspace navigation is pending", { skip: !url }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/api/auth/sign-in/email", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.goto(url!);
    // Hold the browser's cross-document transition, not a network response:
    // retaining the current document lets us inspect its post-success lock.
    await page.evaluate(() => {
      const navigation = (window as unknown as { navigation: EventTarget }).navigation;
      navigation.addEventListener("navigate", (event) => {
        event.preventDefault();
        document.documentElement.dataset.pendingDestination = (event as Event & { destination: { url: string } }).destination.url;
      });
    });
    await page.getByLabel("Email", { exact: true }).fill("invalid@example.test");
    await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    await page.getByRole("button", { name: "Sign in", exact: true }).click({ noWaitAfter: true });
    await page.waitForFunction(() => document.documentElement.dataset.pendingDestination?.endsWith("/work-os"));
    const disabled = await page.evaluate(() => (document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled);
    assert.equal(disabled, true, "successful navigation must not reopen sign-in submission");
  } finally { await browser.close(); }
});

test("login follows a safe post-authentication redirect", { skip: !url }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/api/auth/sign-in/email", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.route("**/work-os/agent-access", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Agent access</h1>" }));
    await page.goto(`${url}?redirect=%2Fwork-os%2Fagent-access`);
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await page.getByRole("button", { name: "Hide password", exact: true }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("invalid@example.test");
    await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/work-os/agent-access");
    assert.equal(new URL(page.url()).pathname, "/work-os/agent-access");
  } finally { await browser.close(); }
});
