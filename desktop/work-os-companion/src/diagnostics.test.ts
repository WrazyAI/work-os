import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { redactString, redactValue } from "./redact";
import { applyDayScenario, applyOnboardingScenario, DEFAULT_DEBUG_SCENARIO, DEBUG_PRESETS } from "./scenarios";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("redaction", () => {
  it("strips tokens, headers, transcripts, and emails", () => {
    const redacted = redactValue({
      token: "secret-token",
      Authorization: "Bearer abc",
      nested: { input_text: "finished the report", path: "/api/work-os/me/workday" },
      note: "contact jane@example.com",
    }) as Record<string, unknown>;
    expect(redacted.token).toBe("[redacted]");
    expect(redacted.Authorization).toBe("[redacted]");
    expect((redacted.nested as Record<string, unknown>).input_text).toBe("[redacted]");
    expect((redacted.nested as Record<string, unknown>).path).toBe("/api/work-os/me/workday");
    expect(String(redacted.note)).toContain("[redacted-email]");
    expect(String(redacted.note)).not.toContain("jane@example.com");
  });

  it("redacts bearer strings", () => {
    expect(redactString("Bearer super-secret")).toBe("[redacted]");
  });
});

describe("scenario regression", () => {
  it("does not mutate server-shaped data when disabled", () => {
    const day = { tasks: [{ id: "1" }], evidence: [], proposals: [], session: null, shift: null, prompt: { kind: null, nextPromptAt: null, required: false, reason: "" }, at: "", shiftDate: "", report: null, plan: null };
    expect(applyDayScenario(day as never, DEFAULT_DEBUG_SCENARIO)).toBe(day);
  });

  it("first launch preset requires onboarding and hides the session", () => {
    const scenario = { ...DEFAULT_DEBUG_SCENARIO, ...DEBUG_PRESETS[0].scenario };
    const onboarding = applyOnboardingScenario(null, scenario);
    expect(onboarding?.onboardingRequired).toBe(true);
    expect(scenario.authState).toBe("unauthenticated");
  });

  it("provider outage marks nifty sync as failed without dropping the day", () => {
    const scenario = { ...DEFAULT_DEBUG_SCENARIO, ...DEBUG_PRESETS.find((item) => item.id === "provider_failure")!.scenario };
    const day = applyDayScenario(null, scenario);
    expect(day?.niftySync?.error).toMatch(/Nifty/);
    expect(day?.tasks.length).toBeGreaterThan(0);
  });
});

describe("event schema", () => {
  it("keeps the diagnostic record fields used by the host pipeline", () => {
    const event = {
      id: "1",
      timestamp: new Date().toISOString(),
      level: "info",
      source: "frontend",
      category: "shift.clock_in.completed",
      message: "shift.clock_in",
      sessionId: "session",
      correlationId: "abc",
      durationMs: 48,
      metadata: redactValue({ token: "nope", path: "/api/work-os/me/workday" }),
    };
    expect(Object.keys(event)).toEqual(expect.arrayContaining(["id", "timestamp", "level", "source", "category", "message", "sessionId"]));
    expect((event.metadata as Record<string, unknown>).token).toBe("[redacted]");
  });

  it("keeps native UTC date conversion on the Gregorian century divisor", () => {
    const diagnostics = readFileSync(resolve(root, "src-tauri/src/diagnostics.rs"), "utf8");
    expect(diagnostics).toContain("yoe / 100");
    expect(diagnostics).not.toContain("yoe / 24");
    expect(diagnostics).toContain("civil_from_days(20_689)");
  });
});

describe("debug window contract", () => {
  it("never overlays the employee UI", () => {
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).not.toContain("debug-overlay");
    expect(app).not.toContain("setDebugOpen");
    expect(app).toContain("openDebuggerWindow");
    expect(app).toContain("Debugger window could not open");
    expect(app).toContain("Open logs folder");
  });

  it("keeps the packaged binary a Windows GUI process", () => {
    const main = readFileSync(resolve(root, "src-tauri/src/main.rs"), "utf8");
    expect(main).toContain('windows_subsystem = "windows"');
  });

  it("splits debug capabilities away from Stronghold", () => {
    const debug = readFileSync(resolve(root, "src-tauri/capabilities/debug.json"), "utf8");
    const mainCap = readFileSync(resolve(root, "src-tauri/capabilities/default.json"), "utf8");
    expect(debug).not.toContain("stronghold");
    expect(debug).not.toContain("deny-get-vault-password");
    expect(debug).toContain('"debug"');
    expect(debug).toContain("allow-debug-commands");
    expect(debug).toContain("core:window:allow-hide");
    expect(mainCap).not.toContain('"debug"');
    expect(mainCap).toContain("stronghold:default");
  });
});

describe("export privacy", () => {
  it("queue summaries may include paths and attempts but not bodies or tokens", () => {
    const summary = redactValue({
      count: 1,
      paths: ["/api/work-os/check-ins"],
      attempts: [1],
      body: { input_text: "secret update", token: "abc" },
    }) as Record<string, unknown>;
    expect(summary.paths).toEqual(["/api/work-os/check-ins"]);
    expect((summary.body as Record<string, unknown>).input_text).toBe("[redacted]");
    expect((summary.body as Record<string, unknown>).token).toBe("[redacted]");
  });
});
