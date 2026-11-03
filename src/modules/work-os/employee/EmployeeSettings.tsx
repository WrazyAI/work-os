"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { supportedTimezones, timezoneLabel } from "../timezones";
import EmployeeMemory from "./EmployeeMemory";
import AgentAccessSettings from "./AgentAccessSettings";
import { useEmployeeWorkspaceAccess } from "./EmployeeWorkspaceShell";
import { fetchJson, requestId, type AnyRow } from "./model";
import styles from "./EmployeeSettings.module.css";

export default function EmployeeSettings() {
  const queryClient = useQueryClient();
  const access = useEmployeeWorkspaceAccess();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [language, setLanguage] = useState("en");
  const [shiftStart, setShiftStart] = useState("09:00");
  const [shiftEnd, setShiftEnd] = useState("17:00");
  const [breakStart, setBreakStart] = useState("");
  const [breakEnd, setBreakEnd] = useState("");
  const [desktopEnabled, setDesktopEnabled] = useState(true);
  const [consent, setConsent] = useState(false);
  const [exclusions, setExclusions] = useState("");
  const hydrationKey = useRef<string | null>(null);

  const onboarding = useQuery<AnyRow>({
    queryKey: ["work-os", "employee-onboarding"],
    queryFn: () => fetchJson("/api/work-os/me/onboarding"),
    staleTime: 30_000,
  });

  useEffect(() => {
    const profile = onboarding.data?.profile;
    if (!profile) return;
    const resetKey = `${String(profile.email ?? "").trim().toLowerCase()}:${onboarding.data?.status ?? "not_started"}`;
    if (hydrationKey.current === resetKey) return;
    hydrationKey.current = resetKey;
    setName(profile.displayName || "");
    setEmail(profile.email || "");
    setTimezone(profile.timezone || "UTC");
    setLanguage(profile.language || "en");
    const schedule = profile.schedule || {};
    setShiftStart(schedule.shiftStart || "09:00");
    setShiftEnd(schedule.shiftEnd || "17:00");
    const firstBreak = Array.isArray(schedule.breaks) ? schedule.breaks[0] : null;
    setBreakStart(firstBreak?.start || "");
    setBreakEnd(firstBreak?.end || "");
    setDesktopEnabled(typeof profile.notifications?.desktopEnabled === "boolean" ? profile.notifications.desktopEnabled : true);
    setConsent(onboarding.data?.employeeRequirements?.consentProvided === true && onboarding.data?.employeeRequirements?.screenshotConsentProvided === true && onboarding.data?.employeeRequirements?.privacyAcknowledged === true);
    setExclusions((profile.privacy?.sensitiveAppExclusions ?? []).join(", "));
  }, [onboarding.data?.profile?.email, onboarding.data?.status]);

  const saveOnboarding = useMutation({
    mutationFn: () => fetchJson("/api/work-os/me/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preferredName: name,
        email,
        timezone,
        language,
        schedule: {
          daysOfWeek: [1, 2, 3, 4, 5],
          shiftStart,
          shiftEnd,
          breaks: breakStart && breakEnd ? [{ start: breakStart, end: breakEnd }] : [],
        },
        notifications: { desktopEnabled },
        privacy: {
          screenshotAnalysisConsent: true,
          sensitiveAppExclusions: exclusions.split(",").map((value) => value.trim()).filter(Boolean),
        },
        acceptTrackingConsent: true,
        privacyNoticeAcknowledged: true,
        revision: onboarding.data?.draft?.revision ?? 0,
        clientMutationKey: requestId(),
        source: "web",
      }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-os", "employee-onboarding"] });
      await queryClient.invalidateQueries({ queryKey: ["work-os", "my-day"] });
    },
  });

  const changeConsent = useMutation({
    mutationFn: (action: "withdraw_tracking" | "withdraw_screenshot_analysis") => fetchJson("/api/work-os/me/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, source: "web" }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-os", "employee-onboarding"] });
      await queryClient.invalidateQueries({ queryKey: ["work-os", "my-day"] });
    },
  });

  const onboardingRequired = onboarding.data?.onboardingRequired === true;
  const organizationSetup = onboarding.data?.organizationSetup;
  const officialSchedule = organizationSetup?.officialSchedule;
  const officialScheduleLabel = officialSchedule
    ? `${officialSchedule.shiftStart}–${officialSchedule.shiftEnd} · ${officialSchedule.timezone}`
    : "Pending manager setup";
  const worktivityBreaks = onboarding.data?.breakPolicy?.worktivityAuthoritative === true;
  const error = onboarding.error || saveOnboarding.error || changeConsent.error;

  if (onboarding.isLoading && !onboarding.data) {
    return (
      <div className={styles.page} aria-busy="true">
        <header className={styles.masthead}>
          <div className={styles.titleRow}><h1>Settings</h1></div>
        </header>
        <div className={styles.groups}>
          <div className={styles.group}>
            <div className={styles.groupLabel}><div className={styles.skeleton} style={{ width: 120 }} /></div>
            <div className={styles.groupContent}><div className={styles.skeletonBlock} /></div>
          </div>
          <div className={styles.group}>
            <div className={styles.groupLabel}><div className={styles.skeleton} style={{ width: 90 }} /></div>
            <div className={styles.groupContent}><div className={styles.skeletonBlock} style={{ height: 140 }} /></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.titleRow}>
          <h1>Settings</h1>
          <p className={styles.titleMeta}>Your profile, working hours, and the consents that keep tracking truthful.</p>
          <span className={`${styles.status} ${onboardingRequired ? styles.statusWarn : styles.statusDone}`}>
            {onboardingRequired ? "Action required" : "Configured"}
          </span>
        </div>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeErr}`}>{(error as Error).message}</div> : null}

      <div className={styles.groups}>
        <section className={styles.group} aria-labelledby="settings-org-title">
          <div className={styles.groupLabel}>
            <h2 id="settings-org-title">Organization</h2>
            <p>Set by your manager; read back from the same record the workspace uses.</p>
          </div>
          <div className={styles.groupContent}>
            <dl className={styles.facts}>
              <Fact label="Official role" value={organizationSetup?.roleProfile?.name || "Pending manager setup"} />
              <Fact label="Team" value={organizationSetup?.teams?.map((team: AnyRow) => team.name).filter(Boolean).join(", ") || "Pending manager setup"} />
              <Fact label="Manager" value={organizationSetup?.managers?.map((manager: AnyRow) => manager.display_name).filter(Boolean).join(", ") || "Pending manager setup"} />
              <Fact label="Official schedule" value={officialScheduleLabel} />
            </dl>
          </div>
        </section>

        <section className={styles.group} aria-labelledby="settings-consent-title">
          <div className={styles.groupLabel}>
            <h2 id="settings-consent-title">{onboardingRequired ? "Complete setup" : "Privacy & consent"}</h2>
            <p>
              {onboardingRequired
                ? "Confirm your profile, working hours, notification preference, and purpose-limited tracking consent."
                : "Tracking consent is active. Sampled analysis is encrypted, retained for 30 days, and never proves productivity or task completion."}
            </p>
          </div>
          <div className={styles.groupContent}>
            {onboardingRequired ? (
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Preferred name</span>
                  <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Work email</span>
                  <input type="email" className={styles.input} value={email} onChange={(event) => setEmail(event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Timezone</span>
                  <input
                    role="combobox"
                    aria-autocomplete="list"
                    list="employee-work-os-timezones"
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    placeholder="Search IANA timezone"
                    className={styles.input}
                  />
                  <datalist id="employee-work-os-timezones">
                    {supportedTimezones().map((zone) => <option key={zone} value={zone}>{timezoneLabel(zone)}</option>)}
                  </datalist>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Language</span>
                  <input className={styles.input} value={language} onChange={(event) => setLanguage(event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Shift start</span>
                  <input type="time" className={styles.input} value={shiftStart} onChange={(event) => setShiftStart(event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Shift end</span>
                  <input type="time" className={styles.input} value={shiftEnd} onChange={(event) => setShiftEnd(event.target.value)} />
                </label>
                {!worktivityBreaks ? (
                  <>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Break start</span>
                      <input type="time" className={styles.input} value={breakStart} onChange={(event) => setBreakStart(event.target.value)} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Break end</span>
                      <input type="time" className={styles.input} value={breakEnd} onChange={(event) => setBreakEnd(event.target.value)} />
                    </label>
                  </>
                ) : null}
                <label className={`${styles.field} ${styles.fieldFull}`}>
                  <span className={styles.fieldLabel}>Sensitive apps/domains to exclude <em>optional</em></span>
                  <input className={styles.input} value={exclusions} onChange={(event) => setExclusions(event.target.value)} placeholder="password manager, bank.example" />
                  <span className={styles.hint}>Comma-separated apps or domains that must never be captured.</span>
                </label>
                <label className={`${styles.checkLine} ${styles.fieldFull}`}>
                  <input type="checkbox" checked={desktopEnabled} onChange={(event) => setDesktopEnabled(event.target.checked)} />
                  Desktop notifications
                </label>
                <label className={`${styles.checkLine} ${styles.consentLine}`}>
                  <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                  <span>I accept Work OS tracking and sampled screenshot analysis, including encrypted 30-day raw retention, sensitive-capture deletion, and that screenshots do not prove productivity or task completion.</span>
                </label>
                <div className={styles.formActions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={!name.trim() || !email.trim() || !consent || saveOnboarding.isPending}
                    onClick={() => saveOnboarding.mutate()}
                  >
                    {saveOnboarding.isPending ? "Saving…" : "Save required consent"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className={styles.consentRow}>
                  <span className={styles.consentChip}>Tracking active</span>
                  <span className={styles.consentChip}>Screenshot analysis active</span>
                  <button type="button" className={`${styles.secondaryButton} ${styles.warnButton}`} disabled={changeConsent.isPending} onClick={() => changeConsent.mutate("withdraw_screenshot_analysis")}>
                    Withdraw screenshot consent
                  </button>
                  <button type="button" className={`${styles.secondaryButton} ${styles.dangerButton}`} disabled={changeConsent.isPending} onClick={() => changeConsent.mutate("withdraw_tracking")}>
                    Withdraw tracking consent
                  </button>
                </div>
                {exclusions ? (
                  <p className={styles.consentDetails}>
                    Excluded apps and domains: <strong>{exclusions}</strong>
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </section>

        <EmployeeMemory enabled={access.featureFlags.work_memory === true} />

        <section className={styles.group} aria-labelledby="settings-api-title">
          <div className={styles.groupLabel}>
            <h2 id="settings-api-title">Agent API</h2>
            <p>For external agents that read tasks and log progress.</p>
          </div>
          <div className={styles.groupContent}>
            <p className={styles.companionCopy}>The guide covers authentication, endpoints, limits, and recovery. Tokens are created below.</p>
            <div className={styles.companionActions}>
              <Link href="/docs/agent-api" className={styles.linkButton}>Open API guide</Link>
            </div>
          </div>
        </section>

        <AgentAccessSettings />

        <section className={styles.group} aria-labelledby="settings-device-title">
          <div className={styles.groupLabel}>
            <h2 id="settings-device-title">This device</h2>
            <p>Preferences stay on this device only.</p>
          </div>
          <div className={styles.groupContent}>
            <div className={styles.deviceFacts}>
              <span>Timezone: <strong>{timezone}</strong>{timezone !== (onboarding.data?.profile?.timezone || timezone) ? " (updated in setup above)" : ""}</span>
              <span>Desktop notifications: <strong>{desktopEnabled ? "On" : "Off"}</strong></span>
            </div>
          </div>
        </section>

        <section className={styles.group} aria-labelledby="settings-companion-title">
          <div className={styles.groupLabel}>
            <h2 id="settings-companion-title">Windows Companion</h2>
            <p>Attendance controls live in the companion.</p>
          </div>
          <div className={styles.groupContent}>
            <p className={styles.companionCopy}>
              Clock in, pause, resume, and clock out from the Windows Work OS Companion; it opens Worktivity if needed and waits for Worktivity to confirm each change. This dashboard stays status-only.
            </p>
            <div className={styles.companionActions}>
              <Link href="/work-os/desktop/connect" className={styles.linkButton}>Connect this computer</Link>
              <button type="button" className={styles.secondaryButton} onClick={() => void onboarding.refetch()} disabled={onboarding.isFetching}>
                <RefreshCw size={13} className={onboarding.isFetching ? "animate-spin" : undefined} /> Refresh setup
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
