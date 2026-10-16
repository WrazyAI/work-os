"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Bell, HardDriveDownload, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { supportedTimezones, timezoneLabel } from "../timezones";
import EmployeeMemory from "./EmployeeMemory";
import { useEmployeeWorkspaceAccess } from "./EmployeeWorkspaceShell";
import { fetchJson, requestId, type AnyRow } from "./model";
import {
  Field,
  Masthead,
  Notice,
  Panel,
  PanelHeader,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
  StatusPill,
  inputClass,
  inputStyle,
} from "./ui";

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
      <div aria-busy="true">
        <Masthead eyebrow="Work OS" title="Settings" meta="Loading your setup…" />
        <Panel className="p-5"><Skeleton className="h-4 w-40" /><Skeleton className="mt-3 h-24 w-full" /></Panel>
      </div>
    );
  }

  return (
    <div>
      <Masthead
        eyebrow="Work OS"
        title="Settings"
        meta="Your profile, working hours, and the consents that keep tracking truthful."
        actions={onboardingRequired ? <StatusPill tone="overdue">Action required</StatusPill> : <StatusPill tone="done">Configured</StatusPill>}
      />

      {error ? <Notice tone="err" className="mb-5">{(error as Error).message}</Notice> : null}

      <div className="grid gap-5">
        <Panel>
          <PanelHeader icon={<UserRound size={16} />} title="Organization setup" meta="Set by your manager; read back from the same record the workspace uses." />
          <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
            <Fact label="Official role" value={organizationSetup?.roleProfile?.name || "Pending manager setup"} />
            <Fact label="Team" value={organizationSetup?.teams?.map((team: AnyRow) => team.name).filter(Boolean).join(", ") || "Pending manager setup"} />
            <Fact label="Manager" value={organizationSetup?.managers?.map((manager: AnyRow) => manager.display_name).filter(Boolean).join(", ") || "Pending manager setup"} />
            <Fact label="Official schedule" value={officialScheduleLabel} />
          </dl>
        </Panel>

        {onboardingRequired ? (
          <Panel>
            <PanelHeader
              icon={<ShieldCheck size={16} />}
              title="Complete your setup"
              meta="Confirm your profile, working hours, notification preference, and purpose-limited tracking consent."
            />
            <div className="grid gap-4 px-5 py-5 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Preferred name">
                <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Work email">
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Timezone">
                <input role="combobox" aria-autocomplete="list" list="employee-work-os-timezones" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Search IANA timezone" className={inputClass} style={inputStyle} />
                <datalist id="employee-work-os-timezones">
                  {supportedTimezones().map((zone) => <option key={zone} value={zone}>{timezoneLabel(zone)}</option>)}
                </datalist>
              </Field>
              <Field label="Language">
                <input value={language} onChange={(event) => setLanguage(event.target.value)} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Shift start">
                <input type="time" value={shiftStart} onChange={(event) => setShiftStart(event.target.value)} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Shift end">
                <input type="time" value={shiftEnd} onChange={(event) => setShiftEnd(event.target.value)} className={inputClass} style={inputStyle} />
              </Field>
              {!worktivityBreaks ? (
                <>
                  <Field label="Break start">
                    <input type="time" value={breakStart} onChange={(event) => setBreakStart(event.target.value)} className={inputClass} style={inputStyle} />
                  </Field>
                  <Field label="Break end">
                    <input type="time" value={breakEnd} onChange={(event) => setBreakEnd(event.target.value)} className={inputClass} style={inputStyle} />
                  </Field>
                </>
              ) : null}
              <Field label="Sensitive apps/domains to exclude" hint="Comma-separated apps or domains that must never be captured.">
                <input value={exclusions} onChange={(event) => setExclusions(event.target.value)} placeholder="password manager, bank.example" className={inputClass} style={inputStyle} />
              </Field>
              <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <input type="checkbox" checked={desktopEnabled} onChange={(event) => setDesktopEnabled(event.target.checked)} /> Desktop notifications
              </label>
              <label className="flex items-start gap-2 text-[12px] leading-5 text-[var(--text-secondary)] md:col-span-2">
                <input type="checkbox" className="mt-0.5" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                <span>I accept Work OS tracking and sampled screenshot analysis, including encrypted 30-day raw retention, sensitive-capture deletion, and that screenshots do not prove productivity or task completion.</span>
              </label>
              <div className="flex items-end">
                <PrimaryButton
                  disabled={!name.trim() || !email.trim() || !consent || saveOnboarding.isPending}
                  onClick={() => saveOnboarding.mutate()}
                  className="w-full sm:w-auto"
                >
                  {saveOnboarding.isPending ? "Saving…" : "Save required consent"}
                </PrimaryButton>
              </div>
            </div>
          </Panel>
        ) : (
          <Panel>
            <PanelHeader
              icon={<ShieldCheck size={16} />}
              title="Privacy & consent"
              meta="Tracking consent is active. Sampled Worktivity analysis is encrypted, retained 30 days, and never proves productivity or task completion."
            />
            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <StatusPill tone="done">Tracking active</StatusPill>
              <StatusPill tone="done">Screenshot analysis active</StatusPill>
              <SecondaryButton disabled={changeConsent.isPending} style={{ color: "var(--status-warn)" }} onClick={() => changeConsent.mutate("withdraw_screenshot_analysis")}>
                Withdraw screenshot consent
              </SecondaryButton>
              <SecondaryButton disabled={changeConsent.isPending} style={{ color: "var(--status-error)" }} onClick={() => changeConsent.mutate("withdraw_tracking")}>
                Withdraw tracking consent
              </SecondaryButton>
            </div>
            {exclusions ? (
              <p className="border-t px-5 py-3 text-[12px] leading-5 text-[var(--text-secondary)]" style={{ borderColor: "var(--border-subtle)" }}>
                Excluded apps and domains: <span className="text-[var(--text-primary)]">{exclusions}</span>
              </p>
            ) : null}
          </Panel>
        )}

        <EmployeeMemory enabled={access.featureFlags.work_memory === true} />

        <Panel>
          <PanelHeader icon={<Bell size={16} />} title="This device" meta="Preferences stay on this device only." />
          <div className="grid gap-3 px-5 py-4 text-[12px] text-[var(--text-secondary)]">
            <p>Timezone: <span className="text-[var(--text-primary)]">{timezone}</span>{timezone !== (onboarding.data?.profile?.timezone || timezone) ? " (updated in setup above)" : ""}</p>
            <p>Desktop notifications: <span className="text-[var(--text-primary)]">{desktopEnabled ? "On" : "Off"}</span></p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            icon={<HardDriveDownload size={16} />}
            title="Windows Companion"
            meta="Attendance controls live in the companion."
          />
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <p className="max-w-xl text-[12px] leading-5 text-[var(--text-secondary)]">
              Clock in, pause, resume, and clock out from the Windows Work OS Companion; it opens Worktivity if needed and waits for Worktivity to confirm each change. This dashboard stays status-only.
            </p>
            <div className="flex gap-2">
              <Link href="/work-os/desktop/connect" className="inline-flex items-center gap-2 rounded-[10px] border px-3.5 py-2 text-[12px] font-semibold" style={{ borderColor: "var(--border)", color: "var(--text-primary)", background: "var(--bg-card)" }}>
                Connect this computer
              </Link>
              <SecondaryButton onClick={() => void onboarding.refetch()} disabled={onboarding.isFetching}>
                <RefreshCw size={13} className={onboarding.isFetching ? "animate-spin" : undefined} /> Refresh setup
              </SecondaryButton>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{label}</dt>
      <dd className="mt-1 text-[13px] font-medium text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}
