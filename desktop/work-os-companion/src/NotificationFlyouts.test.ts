import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appendNotification, notificationAriaRole, notificationTimeoutMs, NotificationFlyouts, type AppNotification } from "./NotificationFlyouts";

describe("application notification flyouts", () => {
  it("renders failures as assertive red flyouts and successes as green status flyouts", () => {
    const notifications: AppNotification[] = [
      { id: "failure", tone: "error", title: "Could not save", message: "Nifty rejected the task." },
      { id: "success", tone: "success", title: "Task created", message: "Nifty confirmed the new task." },
    ];
    const markup = renderToStaticMarkup(createElement(NotificationFlyouts, { notifications, onDismiss: () => undefined }));
    expect(markup).toContain('class="notification-flyout error"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('class="notification-flyout success"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Dismiss Task created");
  });

  it("deduplicates repeated messages and bounds the visible stack", () => {
    const first = appendNotification([], { tone: "error", title: "Failed", message: "Try again." }, 2);
    const repeated = appendNotification(first, { tone: "error", title: "Failed", message: "Try again." }, 2);
    const final = appendNotification(repeated, { tone: "success", title: "Done", message: "Saved." }, 2);
    expect(repeated).toHaveLength(1);
    expect(repeated[0]?.id).not.toBe(first[0]?.id);
    expect(final.map((item) => item.tone)).toEqual(["error", "success"]);
  });

  it("keeps failures visible longer and assigns accessible live roles", () => {
    expect(notificationTimeoutMs("error")).toBeGreaterThan(notificationTimeoutMs("success"));
    expect(notificationAriaRole("error")).toBe("alert");
    expect(notificationAriaRole("success")).toBe("status");
  });

  it("removes page-level error outcomes from the app and onboarding surfaces", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const onboarding = readFileSync(new URL("./Onboarding.tsx", import.meta.url), "utf8");
    const debuggerWindow = readFileSync(new URL("./DebugWindow.tsx", import.meta.url), "utf8");
    expect(`${app}\n${onboarding}\n${debuggerWindow}`).not.toContain('className="notice error"');
    expect(onboarding).not.toContain("onboarding-error");
    expect(app).toContain("notifications.success");
    expect(app).toContain("notifications.error");
  });
});
