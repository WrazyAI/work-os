import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appendNotification, notificationAriaRole, notificationAutoDismissMs, notificationTimeoutMs, NotificationFlyouts, type AppNotification } from "./NotificationFlyouts";

describe("application notification flyouts", () => {
  it("renders failures as assertive red flyouts and successes as green status flyouts", () => {
    const notifications: AppNotification[] = [
      { id: "failure", tone: "error", title: "Could not save", message: "Nifty rejected the task." },
      { id: "success", tone: "success", title: "Task created", message: "Nifty confirmed the new task." },
    ];
    const markup = renderToStaticMarkup(createElement(NotificationFlyouts, { notifications, onDismiss: () => undefined }));
    expect(markup).toContain('class="notification-flyout error transient"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('class="notification-flyout success transient"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Dismiss Task created");
  });

  it("keeps persistent flyouts until dismissal and reserves stack capacity", () => {
    const persistent = appendNotification([], { tone: "info", title: "Work OS ready", message: "Worktivity is syncing.", persistence: "persistent", persistenceKey: "session" }, 2, 2);
    const updated = appendNotification(persistent, { tone: "info", title: "Work OS ready", message: "Activity is still syncing.", persistence: "persistent", persistenceKey: "session" }, 2, 2);
    const stacked = ["one", "two", "three"].reduce((current, message) => appendNotification(current, { tone: "success", title: "Done", message }, 2, 2), updated);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.id).toBe(persistent[0]?.id);
    expect(stacked.filter((item) => item.persistence === "persistent")).toHaveLength(1);
    expect(stacked.filter((item) => item.persistence !== "persistent")).toHaveLength(2);
    const markup = renderToStaticMarkup(createElement(NotificationFlyouts, { notifications: stacked, onDismiss: () => undefined }));
    expect(markup).toContain('class="notification-flyout info persistent"');
    const persistentMarkup = renderToStaticMarkup(createElement(NotificationFlyouts, { notifications: updated, onDismiss: () => undefined }));
    expect(persistentMarkup).not.toContain("<i");
    expect(notificationAutoDismissMs(updated[0]!)).toBeNull();
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

  it("keeps compact rail navigation named when its text labels are visually hidden", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(app).toContain("aria-label={label}");
    expect(app).toContain('aria-current={view === id ? "page" : undefined}');
    expect(app).toContain("title={label}");
  });

  it("renders download progress as an accessible bar without a dismiss while locked", () => {
    const notification: AppNotification = {
      id: "update",
      tone: "info",
      title: "Downloading update",
      message: "Downloading 0.3.03… 2.4 MB of 4.8 MB",
      persistence: "persistent",
      persistenceKey: "work-os-update-available",
      locked: true,
      progress: { value: 50, max: 100, valueText: "2.4 MB of 4.8 MB" },
    };
    const markup = renderToStaticMarkup(createElement(NotificationFlyouts, { notifications: [notification], onDismiss: () => undefined }));
    expect(markup).toContain('class="notification-flyout info persistent locked"');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-label="Download progress"');
    expect(markup).toContain('aria-valuenow="50"');
    expect(markup).toContain('aria-valuetext="2.4 MB of 4.8 MB"');
    expect(markup).toContain("width:50%");
    expect(markup).not.toContain("Dismiss Downloading update");
  });

  it("renders primary and quiet actions side by side once downloaded", () => {
    const notification: AppNotification = {
      id: "update",
      tone: "info",
      title: "Update downloaded",
      message: "Version 0.3.03 is downloaded. Update now, or install it later from Settings.",
      persistence: "persistent",
      persistenceKey: "work-os-update-available",
      actions: [
        { label: "Update now", kind: "primary", onClick: () => undefined },
        { label: "Later", kind: "quiet", onClick: () => undefined },
      ],
    };
    const markup = renderToStaticMarkup(createElement(NotificationFlyouts, { notifications: [notification], onDismiss: () => undefined }));
    expect(markup).toContain("Update now");
    expect(markup).toContain("Later");
    expect(markup).toContain('class="notification-action quiet"');
    expect(markup).toContain("Dismiss Update downloaded");
  });

  it("replaces a persistent card in place when progress advances", () => {
    const started = appendNotification([], {
      tone: "info",
      title: "Downloading update",
      message: "Downloading 0.3.03… 0.0 MB of 4.8 MB",
      persistence: "persistent",
      persistenceKey: "work-os-update-available",
      progress: { value: 0, max: 100, valueText: "0.0 MB of 4.8 MB" },
      locked: true,
    });
    const advanced = appendNotification(started, {
      tone: "info",
      title: "Downloading update",
      message: "Downloading 0.3.03… 2.4 MB of 4.8 MB",
      persistence: "persistent",
      persistenceKey: "work-os-update-available",
      progress: { value: 50, max: 100, valueText: "2.4 MB of 4.8 MB" },
      locked: true,
    });
    expect(advanced).toHaveLength(1);
    expect(advanced[0]?.id).toBe(started[0]?.id);
    expect(advanced[0]?.progress?.value).toBe(50);
    expect(advanced[0]?.locked).toBe(true);
  });
});
