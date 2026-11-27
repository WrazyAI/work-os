import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { errorMessage } from "../../auth";
import { markCleanExit } from "../../bootTrace";
import { diagnostics } from "../../diagnostics";
import type { useNotifications } from "../../NotificationFlyouts";
import type { DesktopSession } from "../../types";
import {
  UPDATE_AVAILABLE_KEY,
  UPDATE_CHECK_CADENCE_COPY,
  UPDATE_CHECK_INTERVAL_MS,
  applyDownloadEvent,
  canRunBackgroundUpdateCheck,
  displayUpdateVersion,
  INITIAL_UPDATE_DOWNLOAD_PROGRESS,
  queryAvailableUpdate,
  resolvePendingUpdate,
  updateAvailableCopy,
  updateDownloadedCopy,
  updateDownloadFailedCopy,
  updateProgressDetails,
  type UpdateChannel,
  type UpdateDownloadProgress,
  type UpdateRowCopyInput,
} from "../../updater";
import { secureState } from "../../vault";
import { readAnnouncedVersion, shouldAnnounceUpdate, updateInstalledCopy, WHATS_NEW_ANNOUNCE_KEY, writeAnnouncedVersion } from "../../whatsNew";
import type { UpdateFlow } from "../types";

export function useUpdaterFlow({
  session,
  apiBase,
  notifications,
  showError,
}: {
  session: DesktopSession | null;
  apiBase: string;
  notifications: ReturnType<typeof useNotifications>;
  showError: (error: unknown, fallback: string, title?: string) => void;
}) {
  const [updateFlow, setUpdateFlow] = useState<UpdateFlow>({ status: "idle" });
  const updateFlowRef = useRef<UpdateFlow>({ status: "idle" });
  const activeCheckEpochRef = useRef<number | null>(null);
  const updatePaintRef = useRef<number | null>(null);
  const launchUpdateCheckRef = useRef(false);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [updateChannel, setUpdateChannelState] = useState<UpdateChannel>("stable");
  const updateChannelRef = useRef<UpdateChannel>("stable");
  const savedUpdateChannelRef = useRef<UpdateChannel>("stable");
  const channelEpochRef = useRef(0);
  const channelOpRef = useRef(0);
  const channelSaveInFlightRef = useRef(0);
  const [installedVersion, setInstalledVersion] = useState("Reading installed version…");

  useEffect(() => {
    if (!isTauri()) return;
    // The bundle keeps the stable icon so Stable promotion can reuse the
    // Windows installer verbatim; swap the live window/tray/Dock icon instead.
    void invoke("set_update_channel_icon", { channel: updateChannel }).catch(() => undefined);
  }, [updateChannel]);

  const applyUpdateChannel = useCallback((channel: UpdateChannel) => {
    if (updateChannelRef.current !== channel) {
      channelEpochRef.current += 1;
    }
    updateChannelRef.current = channel;
    setUpdateChannelState(channel);
  }, []);

  const setUpdateChannel = useCallback((channel: UpdateChannel) => {
    savedUpdateChannelRef.current = channel;
    applyUpdateChannel(channel);
  }, [applyUpdateChannel]);
  const [installedVersionRaw, setInstalledVersionRaw] = useState<string | null>(null);
  const [whatsNew, setWhatsNew] = useState<{ version: string } | null>(null);

  const markUpdateAnnounced = useCallback((version: string) => {
    writeAnnouncedVersion(version);
    notifications.clearPersistent(WHATS_NEW_ANNOUNCE_KEY);
  }, [notifications]);

  const updateRowSummary: UpdateRowCopyInput =
    updateFlow.status === "available" ? { status: "available", version: updateFlow.update.version }
    : updateFlow.status === "downloading" ? { status: "downloading", version: updateFlow.update.version, progress: updateFlow.progress }
    : updateFlow.status === "downloaded" ? { status: "downloaded", version: updateFlow.update.version }
    : updateFlow.status === "failed" ? { status: "failed", version: updateFlow.update.version, message: updateFlow.message }
    : updateFlow.status === "installing" ? { status: "installing", version: updateFlow.update.version }
    : { status: updateFlow.status };

  /** Closes the plugin's native download resource when a pending entry is
   * replaced, so superseded installers cannot pin memory. Downloaded entries
   * hold the same native resource as available/failed ones. */
  function discardUpdateEntry(flow: UpdateFlow) {
    if (flow.status === "available" || flow.status === "failed" || flow.status === "downloaded") {
      void flow.update.close().catch(() => undefined);
    }
  }

  /** Raises the persistent install prompt for a downloaded update. Reusing the
   * stable key replaces a visible prompt and re-raises one the user dismissed
   * with "Later". */
  function raiseDownloadedUpdateNotification(version: string) {
    const copy = updateDownloadedCopy(version);
    notifications.persistent(UPDATE_AVAILABLE_KEY, copy.message, copy.title, "info", {
      actions: [
        { label: "Update now", kind: "primary", onClick: () => void installDownloadedUpdate() },
        { label: "Later", kind: "quiet", onClick: () => notifications.clearPersistent(UPDATE_AVAILABLE_KEY) },
      ],
    });
  }

  async function beginUpdateDownload() {
    if (channelSaveInFlightRef.current > 0) return;
    const flow = updateFlowRef.current;
    if (flow.status !== "available" && flow.status !== "failed") return;
    const downloadEpoch = channelEpochRef.current;
    const { update, headers } = flow;
    const display = displayUpdateVersion(update.version);
    updatePaintRef.current = null;
    setUpdateFlow({ status: "downloading", update, headers, progress: INITIAL_UPDATE_DOWNLOAD_PROGRESS });
    const publishProgress = (progress: UpdateDownloadProgress, force = false) => {
      if (channelEpochRef.current !== downloadEpoch) return;
      const details = updateProgressDetails(progress);
      const paintKey = details.percent ?? Math.floor(progress.receivedBytes / (256 * 1024));
      if (!force && updatePaintRef.current === paintKey) return;
      updatePaintRef.current = paintKey;
      notifications.persistent(UPDATE_AVAILABLE_KEY, `Downloading ${display}… ${details.valueText}`, "Downloading update", "info", {
        progress: { value: details.percent, max: 100, valueText: details.valueText },
        locked: true,
      });
    };
    publishProgress(INITIAL_UPDATE_DOWNLOAD_PROGRESS, true);
    let progress = INITIAL_UPDATE_DOWNLOAD_PROGRESS;
    try {
      await update.download((event) => {
        if (channelEpochRef.current !== downloadEpoch) return;
        progress = applyDownloadEvent(progress, event);
        setUpdateFlow((current) => current.status === "downloading" ? { ...current, progress } : current);
        publishProgress(progress);
      }, { headers });
    } catch (value) {
      if (channelEpochRef.current !== downloadEpoch) {
        void update.close().catch(() => undefined);
        notifications.clearPersistent(UPDATE_AVAILABLE_KEY);
        if (updateFlowRef.current.status === "downloading") setUpdateFlow({ status: "idle" });
        return;
      }
      const message = errorMessage(value, "The download did not finish.");
      diagnostics.warn("updater.download_failed", message);
      setUpdateFlow({ status: "failed", update, headers, message });
      const copy = updateDownloadFailedCopy(update.version, message);
      notifications.persistent(UPDATE_AVAILABLE_KEY, copy.message, copy.title, "error", {
        actions: [{ label: "Retry", kind: "primary", onClick: () => void beginUpdateDownload() }],
      });
      return;
    }
    if (channelEpochRef.current !== downloadEpoch) {
      void update.close().catch(() => undefined);
      notifications.clearPersistent(UPDATE_AVAILABLE_KEY);
      if (updateFlowRef.current.status === "downloading") setUpdateFlow({ status: "idle" });
      return;
    }
    setUpdateFlow({ status: "downloaded", update });
    raiseDownloadedUpdateNotification(update.version);
  }

  async function installDownloadedUpdate() {
    const flow = updateFlowRef.current;
    if (flow.status !== "downloaded") return;
    notifications.clearPersistent(UPDATE_AVAILABLE_KEY);
    setUpdateFlow({ status: "installing", update: flow.update });
    markCleanExit();
    let watchdogArmed = false;
    try {
      await invoke("arm_update_exit_watchdog");
      watchdogArmed = true;
    } catch (value) {
      diagnostics.warn("updater.watchdog_unavailable", errorMessage(value, "The exit watchdog could not be armed."));
    }
    try {
      await flow.update.install();
    } catch (value) {
      if (watchdogArmed) await invoke("disarm_update_exit_watchdog").catch(() => undefined);
      const message = errorMessage(value, "The update could not be installed.");
      diagnostics.warn("updater.install_failed", message);
      setUpdateFlow({ status: "downloaded", update: flow.update });
      notifications.persistent(UPDATE_AVAILABLE_KEY, `${message} Retry the install, or quit Work OS from the system tray and run the setup installer again.`, "Update failed", "error", {
        actions: [
          { label: "Retry", kind: "primary", onClick: () => void installDownloadedUpdate() },
          { label: "Later", kind: "quiet", onClick: () => notifications.clearPersistent(UPDATE_AVAILABLE_KEY) },
        ],
      });
      return;
    }
    await relaunch();
  }

  async function checkForUpdates({ silent = false, channel }: { silent?: boolean; channel?: UpdateChannel } = {}) {
    const checkEpoch = channelEpochRef.current;
    if (activeCheckEpochRef.current === checkEpoch || channelSaveInFlightRef.current > 0) return;
    const previous = updateFlowRef.current;
    if (!canRunBackgroundUpdateCheck(previous.status)) return;
    const activeChannel = channel ?? updateChannelRef.current;
    activeCheckEpochRef.current = checkEpoch;
    const checkingFlow: UpdateFlow = { status: "checking" };
    updateFlowRef.current = checkingFlow;
    setUpdateFlow(checkingFlow);
    try {
      const saved = await secureState.session();
      if (channelEpochRef.current !== checkEpoch) {
        discardUpdateEntry(previous);
        if (activeCheckEpochRef.current === checkEpoch) {
          notifications.clearPersistent(UPDATE_AVAILABLE_KEY);
          if (updateFlowRef.current.status === "checking") {
            updateFlowRef.current = { status: "idle" };
            setUpdateFlow({ status: "idle" });
          }
        }
        return;
      }
      if (!saved) {
        updateFlowRef.current = previous;
        setUpdateFlow(previous);
        if (!silent) notifications.info("Sign in first, then check for updates.", "Not signed in");
        return;
      }
      const result = await queryAvailableUpdate({ ...saved, updateChannel: activeChannel });
      if (channelEpochRef.current !== checkEpoch) {
        discardUpdateEntry(previous);
        if (result.status === "available") void result.update.close().catch(() => undefined);
        if (activeCheckEpochRef.current === checkEpoch) {
          notifications.clearPersistent(UPDATE_AVAILABLE_KEY);
          if (updateFlowRef.current.status === "checking") {
            updateFlowRef.current = { status: "idle" };
            setUpdateFlow({ status: "idle" });
          }
        }
        return;
      }
      if (result.status === "managed") {
        updateFlowRef.current = previous;
        setUpdateFlow(previous);
        if (!silent) notifications.info("Updates are managed by your WrazyOS server.", "Managed update channel");
        return;
      }
      if (result.status === "current") {
        if (previous.status === "available" || previous.status === "failed" || previous.status === "downloaded") discardUpdateEntry(previous);
        updateFlowRef.current = { status: "idle" };
        setUpdateFlow({ status: "idle" });
        if (!silent) {
          notifications.success(
            activeChannel === "nightly"
              ? "You already have the latest Nightly build."
              : "You already have the latest Stable build.",
            "Work OS is up to date",
          );
        }
        return;
      }
      if (previous.status === "available" || previous.status === "failed" || previous.status === "downloaded") {
        const resolution = resolvePendingUpdate({ status: previous.status, version: previous.update.version }, result.update.version);
        if (resolution !== "replace") {
          void result.update.close().catch(() => undefined);
          updateFlowRef.current = previous;
          setUpdateFlow(previous);
          if (resolution === "re-raise") raiseDownloadedUpdateNotification(previous.update.version);
          return;
        }
        discardUpdateEntry(previous);
      }
      const availableFlow: UpdateFlow = { status: "available", update: result.update, headers: result.headers };
      updateFlowRef.current = availableFlow;
      setUpdateFlow(availableFlow);
      const copy = updateAvailableCopy(result.update.version);
      notifications.persistent(UPDATE_AVAILABLE_KEY, copy.message, copy.title, "info", {
        action: { label: copy.actionLabel, onClick: () => void beginUpdateDownload() },
      });
    } catch (value) {
      if (channelEpochRef.current !== checkEpoch) {
        discardUpdateEntry(previous);
        if (activeCheckEpochRef.current === checkEpoch) {
          notifications.clearPersistent(UPDATE_AVAILABLE_KEY);
          if (updateFlowRef.current.status === "checking") {
            updateFlowRef.current = { status: "idle" };
            setUpdateFlow({ status: "idle" });
          }
        }
        return;
      }
      const message = errorMessage(value, "The update catalog could not be checked.");
      diagnostics.warn("updater.check_failed", message);
      const keepPrevious = previous.status === "available" || previous.status === "failed" || previous.status === "downloaded";
      const nextFlow = keepPrevious ? previous : { status: "idle" as const };
      updateFlowRef.current = nextFlow;
      setUpdateFlow(nextFlow);
      if (!silent) showError(message, message, "Update failed");
    } finally {
      if (activeCheckEpochRef.current === checkEpoch) activeCheckEpochRef.current = null;
    }
  }

  async function toggleAutoCheckUpdates(enabled: boolean) {
    const previous = autoCheckUpdates;
    setAutoCheckUpdates(enabled);
    try {
      await secureState.saveSettings({ apiBase, autoCheckUpdates: enabled });
      notifications.success(enabled ? `Work OS will check for updates on launch and ${UPDATE_CHECK_CADENCE_COPY}.` : "Work OS will no longer check for updates automatically.", "Update setting saved");
    } catch (value) {
      setAutoCheckUpdates(previous);
      showError(errorMessage(value, "The update setting could not be saved."), "The update setting could not be saved.", "Setting not saved");
    }
  }

  function clearChannelPendingUpdate() {
    const pending = updateFlowRef.current;
    if (pending.status === "available" || pending.status === "failed" || pending.status === "downloaded") {
      discardUpdateEntry(pending);
      notifications.clearPersistent(UPDATE_AVAILABLE_KEY);
      updateFlowRef.current = { status: "idle" };
      setUpdateFlow({ status: "idle" });
    } else if (pending.status === "checking") {
      updateFlowRef.current = { status: "idle" };
      setUpdateFlow({ status: "idle" });
    }
  }

  async function chooseUpdateChannel(channel: UpdateChannel) {
    const pending = updateFlowRef.current;
    if (pending.status === "downloading" || pending.status === "installing") return;
    if (channel === updateChannelRef.current) return;
    const opId = ++channelOpRef.current;
    channelSaveInFlightRef.current += 1;
    applyUpdateChannel(channel);
    clearChannelPendingUpdate();
    let saved = false;
    try {
      await secureState.saveSettings({ apiBase, updateChannel: channel });
      savedUpdateChannelRef.current = channel;
      saved = true;
      if (channelOpRef.current !== opId) return;
      notifications.success(
        channel === "nightly"
          ? "Switched to Nightly updates. Checking for the latest developer build…"
          : "Switched to Stable updates. You will receive tested Stable builds.",
        "Release channel saved",
      );
    } catch (value) {
      if (channelOpRef.current === opId) {
        clearChannelPendingUpdate();
        applyUpdateChannel(savedUpdateChannelRef.current);
        showError(errorMessage(value, "The release channel could not be saved."), "The release channel could not be saved.", "Setting not saved");
      }
    } finally {
      channelSaveInFlightRef.current = Math.max(0, channelSaveInFlightRef.current - 1);
    }
    if (saved && channelOpRef.current === opId && isTauri() && session) {
      void checkForUpdates({ silent: true, channel });
    }
  }

  useEffect(() => {
    if (!isTauri()) {
      setInstalledVersion("Unavailable in browser preview");
      return;
    }
    void getVersion().then((value) => {
      setInstalledVersionRaw(value);
      setInstalledVersion(displayUpdateVersion(value));
      if (!shouldAnnounceUpdate(value, readAnnouncedVersion())) return;
      const copy = updateInstalledCopy(value);
      notifications.persistent(WHATS_NEW_ANNOUNCE_KEY, copy.message, copy.title, "success", {
        actions: [
          { label: copy.changelogLabel, kind: "primary", onClick: () => { markUpdateAnnounced(value); setWhatsNew({ version: value }); } },
          { label: copy.dismissLabel, kind: "quiet", onClick: () => markUpdateAnnounced(value) },
        ],
      });
    }).catch(() => setInstalledVersion("Unavailable"));
  }, [markUpdateAnnounced, notifications]);

  useEffect(() => { updateFlowRef.current = updateFlow; }, [updateFlow]);

  useEffect(() => {
    if (!isTauri() || !session || !autoCheckUpdates) return;
    const timer = window.setInterval(() => {
      const flow = updateFlowRef.current;
      if (!canRunBackgroundUpdateCheck(flow.status)) return;
      void checkForUpdates({ silent: true });
    }, UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheckUpdates, session]);

  return {
    updateFlow,
    updateRowSummary,
    autoCheckUpdates,
    setAutoCheckUpdates,
    updateChannel,
    setUpdateChannel,
    chooseUpdateChannel,
    installedVersion,
    installedVersionRaw,
    whatsNew,
    setWhatsNew,
    launchUpdateCheckRef,
    beginUpdateDownload,
    installDownloadedUpdate,
    checkForUpdates,
    toggleAutoCheckUpdates,
  };
}
