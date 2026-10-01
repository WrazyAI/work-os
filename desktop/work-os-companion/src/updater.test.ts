import { describe, expect, it } from "vitest";
import {
  INITIAL_UPDATE_DOWNLOAD_PROGRESS,
  UPDATE_AVAILABLE_KEY,
  UPDATE_CHECK_CADENCE_COPY,
  UPDATE_CHECK_INTERVAL_MS,
  applyDownloadEvent,
  canRunBackgroundUpdateCheck,
  displayUpdateVersion,
  formatMegabytes,
  isManagedUpdateChannel,
  resolvePendingUpdate,
  shouldAutoCheckUpdate,
  updateAuthHeaders,
  updateAvailableCopy,
  updateChannelOrigin,
  updateDownloadedCopy,
  updateDownloadFailedCopy,
  updateProgressDetails,
  updateRowCopy,
} from "./updater";

describe("updateChannelOrigin", () => {
  it("points at the WrazyOS catalog by default", () => {
    expect(updateChannelOrigin()).toBe("https://app.wrazyos.com");
  });
});

describe("isManagedUpdateChannel", () => {
  it("uses the companion catalog for the WrazyOS origin", () => {
    expect(isManagedUpdateChannel("https://app.wrazyos.com")).toBe(false);
  });

  it("defers to the server for any other origin", () => {
    expect(isManagedUpdateChannel("https://updates.example.com")).toBe(true);
  });

  it("defers when the address is not a URL at all", () => {
    expect(isManagedUpdateChannel("not a url")).toBe(true);
  });
});

describe("updateAuthHeaders", () => {
  it("carries the session token and organization scope", () => {
    expect(updateAuthHeaders({ token: "t-1", organizationId: "org-1" })).toEqual({
      Authorization: "Bearer t-1",
      "X-Work-OS-Organization-Id": "org-1",
    });
  });
});

describe("shouldAutoCheckUpdate", () => {
  const base = { supported: true, debugEnabled: false, hasSession: true, autoCheckUpdates: true };

  it("checks on launch when everything lines up", () => {
    expect(shouldAutoCheckUpdate(base)).toBe(true);
  });

  it("stays quiet without a native runtime, session, or opt-in", () => {
    expect(shouldAutoCheckUpdate({ ...base, supported: false })).toBe(false);
    expect(shouldAutoCheckUpdate({ ...base, hasSession: false })).toBe(false);
    expect(shouldAutoCheckUpdate({ ...base, autoCheckUpdates: false })).toBe(false);
  });

  it("never phones home from debug scenarios", () => {
    expect(shouldAutoCheckUpdate({ ...base, debugEnabled: true })).toBe(false);
  });
});

describe("displayUpdateVersion", () => {
  it("pads the patch segment to two digits for the display convention", () => {
    expect(displayUpdateVersion("0.3.1")).toBe("0.3.01");
    expect(displayUpdateVersion("0.3.9")).toBe("0.3.09");
  });

  it("leaves wider patches and non-semver strings untouched", () => {
    expect(displayUpdateVersion("0.2.100")).toBe("0.2.100");
    expect(displayUpdateVersion("1.0.0")).toBe("1.0.00");
    expect(displayUpdateVersion("dev")).toBe("dev");
  });

  it("pads the copy without changing the canonical versions being compared", () => {
    const copy = updateAvailableCopy("0.3.1");
    expect(copy.title).toContain("0.3.01");
    expect(copy.message).toContain("0.3.01");
  });
});

describe("updateAvailableCopy", () => {
  it("names the exact version and offers a deferred download", () => {
    const copy = updateAvailableCopy("0.2.61");
    expect(copy.title).toContain("0.2.61");
    expect(copy.message).toContain("0.2.61");
    expect(copy.message).toMatch(/ready to download now/i);
    expect(copy.message).toMatch(/later from settings/i);
    expect(copy.actionLabel).toBe("Download update");
  });

  it("uses a stable flyout key so repeats replace instead of stacking", () => {
    expect(UPDATE_AVAILABLE_KEY).toBe("work-os-update-available");
  });
});

describe("background check cadence", () => {
  it("checks every twenty minutes and derives the settings copy", () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(20 * 60 * 1000);
    expect(UPDATE_CHECK_CADENCE_COPY).toBe("every 20 minutes");
  });
});

describe("canRunBackgroundUpdateCheck", () => {
  it("keeps checking after a download the user has not installed", () => {
    expect(canRunBackgroundUpdateCheck("downloaded")).toBe(true);
  });

  it("allows the quiet states", () => {
    expect(canRunBackgroundUpdateCheck("idle")).toBe(true);
    expect(canRunBackgroundUpdateCheck("available")).toBe(true);
    expect(canRunBackgroundUpdateCheck("failed")).toBe(true);
  });

  it("blocks while a download or install owns the native resource", () => {
    expect(canRunBackgroundUpdateCheck("downloading")).toBe(false);
    expect(canRunBackgroundUpdateCheck("installing")).toBe(false);
  });

  it("does not start a second check while one is in flight", () => {
    expect(canRunBackgroundUpdateCheck("checking")).toBe(false);
  });
});

describe("resolvePendingUpdate", () => {
  it("re-raises the install prompt when the catalog repeats a downloaded version", () => {
    expect(resolvePendingUpdate({ status: "downloaded", version: "0.3.10" }, "0.3.10")).toBe("re-raise");
  });

  it("keeps an available or failed entry on the same version", () => {
    expect(resolvePendingUpdate({ status: "available", version: "0.3.10" }, "0.3.10")).toBe("keep");
    expect(resolvePendingUpdate({ status: "failed", version: "0.3.10" }, "0.3.10")).toBe("keep");
  });

  it("replaces any pending entry when a newer version arrives", () => {
    expect(resolvePendingUpdate({ status: "downloaded", version: "0.3.10" }, "0.3.11")).toBe("replace");
    expect(resolvePendingUpdate({ status: "available", version: "0.3.10" }, "0.3.11")).toBe("replace");
    expect(resolvePendingUpdate({ status: "failed", version: "0.3.10" }, "0.3.11")).toBe("replace");
  });
});

describe("applyDownloadEvent", () => {
  it("folds Started, Progress, and Finished into byte progress", () => {
    const started = applyDownloadEvent(INITIAL_UPDATE_DOWNLOAD_PROGRESS, { event: "Started", data: { contentLength: 5_000_000 } });
    expect(started).toEqual({ receivedBytes: 0, totalBytes: 5_000_000, status: "downloading" });
    const midway = applyDownloadEvent(started, { event: "Progress", data: { chunkLength: 2_500_000 } });
    expect(midway.receivedBytes).toBe(2_500_000);
    const finished = applyDownloadEvent(midway, { event: "Finished" });
    expect(finished.status).toBe("downloaded");
    expect(finished.receivedBytes).toBe(2_500_000);
  });

  it("keeps a missing content length nullable", () => {
    const started = applyDownloadEvent(INITIAL_UPDATE_DOWNLOAD_PROGRESS, { event: "Started", data: {} });
    expect(started.totalBytes).toBeNull();
  });
});

describe("download progress copy", () => {
  it("reports received of total with a percentage when the total is known", () => {
    const details = updateProgressDetails({ receivedBytes: 2_500_000, totalBytes: 5_000_000, status: "downloading" });
    expect(details.valueText).toBe("2.4 MB of 4.8 MB");
    expect(details.percent).toBe(50);
  });

  it("falls back to received bytes when the total is unknown", () => {
    const details = updateProgressDetails({ receivedBytes: 1_048_576, totalBytes: null, status: "downloading" });
    expect(details.valueText).toBe("1.0 MB downloaded");
    expect(details.percent).toBeNull();
  });

  it("scales megabytes past one hundred without decimals", () => {
    expect(formatMegabytes(157_286_400)).toBe("150 MB");
    expect(formatMegabytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("updateRowCopy", () => {
  it("reads every flow state back to the user", () => {
    expect(updateRowCopy({ status: "idle" }, "0.3.2")).toBe("Installed version 0.3.2");
    expect(updateRowCopy({ status: "checking" }, "0.3.2")).toContain("Checking securely");
    expect(updateRowCopy({ status: "available", version: "0.3.3" }, "0.3.2")).toContain("Version 0.3.03 available");
    expect(updateRowCopy({ status: "downloading", version: "0.3.3", progress: { receivedBytes: 2_500_000, totalBytes: 5_000_000, status: "downloading" } }, "0.3.2")).toBe("Downloading 0.3.03… 2.4 MB of 4.8 MB");
    expect(updateRowCopy({ status: "downloaded", version: "0.3.3" }, "0.3.2")).toBe("Version 0.3.03 downloaded — ready to install");
    expect(updateRowCopy({ status: "failed", version: "0.3.3", message: "Network unreachable." }, "0.3.2")).toContain("Version 0.3.03 download failed · Network unreachable.");
    expect(updateRowCopy({ status: "installing", version: "0.3.3" }, "0.3.2")).toBe("Closing Work OS to install 0.3.03…");
  });
});

describe("update lifecycle copy", () => {
  it("offers the deferral path once downloaded", () => {
    const copy = updateDownloadedCopy("0.3.3");
    expect(copy.message).toContain("0.3.03");
    expect(copy.message).toMatch(/update now/i);
    expect(copy.message).toMatch(/later from settings/i);
  });

  it("names the failure and the recovery step", () => {
    const copy = updateDownloadFailedCopy("0.3.3", "The download did not finish.");
    expect(copy.title).toBe("Update download failed");
    expect(copy.message).toContain("0.3.03");
    expect(copy.message).toMatch(/check your connection and try again/i);
  });
});
