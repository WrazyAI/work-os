"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
  FileText,
  Globe2,
  Link2,
  ListChecks,
  Loader2,
  Monitor,
  ShieldCheck,
  X,
} from "lucide-react";
import type { WorkOsWorkspaceChoice } from "@/modules/work-os/workspace";

export type ConnectStatus = "idle" | "working" | "authorized" | "error";

const PRIMARY_BUTTON =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-5 text-[13px] font-semibold text-[var(--text-inverse)] shadow-[var(--shadow-sm)] transition hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--border-hot)] bg-[var(--bg-card)] px-4 text-[13px] font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:scale-[0.99]";
const DEVICE_TILE =
  "relative rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-3.5 shadow-[var(--shadow-sm)]";
const DEVICE_MARK =
  "flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]";

const SCOPES = [
  { icon: CalendarDays, label: "See your schedule and workday" },
  { icon: ListChecks, label: "Read and update tasks, updates, and evidence" },
  { icon: FileText, label: "Draft proposals and end-of-day reports" },
];

export type DesktopConnectViewProps = {
  accountLabel: string;
  workspaces: WorkOsWorkspaceChoice[];
  organizationId: string;
  onOrganizationChange: (value: string) => void;
  requestValid: boolean;
  requestPresent: boolean;
  status: ConnectStatus;
  error: string;
  callbackUrl: string | null;
  onApprove: () => void;
  onOpenCompanion: () => void;
  onStartOver: () => void;
  onClose: () => void;
};

function initials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}

function ActionNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-5 flex items-start gap-2.5 rounded-[12px] border px-3.5 py-3 text-[12px] leading-5 text-[var(--status-error)]"
      style={{
        borderColor: "color-mix(in srgb, var(--status-error) 28%, transparent)",
        background: "color-mix(in srgb, var(--status-error) 6%, transparent)",
      }}
    >
      <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * The rendered authorization state, split from the request so the approved
 * and failed states can be reviewed without a live backend. The approved
 * state never opens the companion by itself: the external-protocol launch
 * needs a direct press, which is why the page keeps a visible button instead
 * of navigating from the fetch callback.
 */
export function DesktopConnectView({
  accountLabel,
  workspaces,
  organizationId,
  onOrganizationChange,
  requestValid,
  requestPresent,
  status,
  error,
  callbackUrl,
  onApprove,
  onOpenCompanion,
  onStartOver,
  onClose,
}: DesktopConnectViewProps) {
  const selectable = workspaces.filter((workspace) => Boolean(workspace.personId));
  const selected = selectable.find((workspace) => workspace.organizationId === organizationId) ?? null;
  const approved = status === "authorized";
  const working = status === "working";
  const failed = status === "error";
  const canApprove = requestValid && Boolean(selected) && !working;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (approved) headingRef.current?.focus();
  }, [approved]);

  const statusLabel = approved ? "Authorized" : working ? "Authorizing" : failed ? "Not authorized" : "Waiting for approval";
  const dotTone = approved ? "bg-[var(--accent)]" : failed ? "bg-[var(--status-error)]" : "bg-[var(--status-warn)]";
  const statusTone = failed ? "text-[var(--status-error)]" : "text-[var(--text-secondary)]";
  const connectionLine = approved ? "scale-y-100" : "scale-y-0";
  const connectionTone = approved
    ? "border-[var(--accent)] text-[var(--accent)]"
    : failed
      ? "border-[var(--status-error)] text-[var(--status-error)]"
      : "border-[var(--border-hot)] text-[var(--text-tertiary)]";

  function restart() {
    onStartOver();
    headingRef.current?.focus();
  }

  const workspaceRow = selected ? (
    <div className="mt-6 flex items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg-primary)] px-3.5 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-card)] text-[var(--text-secondary)]">
        <Building2 size={15} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-[var(--text-secondary)]">Workspace</p>
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{selected.name}</p>
      </div>
    </div>
  ) : null;

  return (
    <main className="flex min-h-[calc(100vh-9.5rem)] items-center justify-center px-4 py-10 text-[var(--text-primary)] sm:px-6">
      <p className="sr-only" role="status" aria-live="polite">
        {approved
          ? "Device authorized. Open Work OS Companion to finish connecting."
          : working
            ? "Authorizing this device."
            : failed
              ? "This device was not authorized."
              : "Ready to authorize this device."}
      </p>
      <section
        aria-labelledby="desktop-connect-title"
        className="w-full max-w-[920px] overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--shadow-md)]"
      >
        <div className="grid md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="p-6 sm:p-8 lg:p-10">
            <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]">
              <ShieldCheck size={15} className="text-[var(--accent)]" aria-hidden="true" />
              <span>Device access</span>
            </div>
            <h1
              ref={headingRef}
              tabIndex={-1}
              id="desktop-connect-title"
              className="mt-4 text-[clamp(1.75rem,4vw,2.5rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-[var(--text-primary)] focus:outline-none"
            >
              {approved ? "Device authorized" : "Authorize this device"}
            </h1>
            <p className="mt-3 max-w-[47ch] text-[14px] leading-6 text-[var(--text-secondary)] sm:text-[15px]">
              {approved
                ? "Work OS approved this PC. Open the companion to finish connecting — it is waiting for you."
                : "This browser is asking to connect to Work OS Companion on your PC. The companion can read and update your workday."}
            </p>

            <div className="mt-5 flex items-center gap-3">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[12px] font-semibold text-[var(--text-secondary)]"
                aria-hidden="true"
              >
                {initials(accountLabel)}
              </span>
              <p className="min-w-0 text-[12px] leading-5 text-[var(--text-secondary)]">
                Signed in as <span className="font-semibold text-[var(--text-primary)]">{accountLabel}</span>
              </p>
            </div>

            {approved ? (
              <div className="mt-7 rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-subtle)] px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-inverse)]">
                    <Check size={12} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-[var(--text-primary)]">Approved for this PC</p>
                    <p className="mt-0.5 text-[12px] leading-5 text-[var(--text-secondary)]">
                      This approval is single-use and lasts five minutes. Open Work OS now to finish.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-6 border-t border-[var(--border)] pt-5">
                  <p className="text-[12px] font-semibold text-[var(--text-primary)]">This device can</p>
                  <ul className="mt-3 grid gap-2.5">
                    {SCOPES.map(({ icon: Icon, label }) => (
                      <li key={label} className="flex items-start gap-2.5 text-[13px] leading-5 text-[var(--text-secondary)]">
                        <Icon size={15} className="mt-0.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
                        <span>{label}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {selectable.length > 1 ? (
                  <div className="mt-6 grid gap-1.5">
                    <label htmlFor="companion-workspace" className="text-[12px] font-semibold text-[var(--text-primary)]">
                      Workspace
                    </label>
                    <select
                      id="companion-workspace"
                      value={organizationId}
                      onChange={(event) => onOrganizationChange(event.target.value)}
                      className="h-11 w-full rounded-[10px] border border-[var(--border-hot)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      <option value="" disabled>Choose a workspace</option>
                      {selectable.map((workspace) => (
                        <option key={workspace.organizationId} value={workspace.organizationId}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] leading-5 text-[var(--text-secondary)]">
                      This device will open the workspace you choose. You can reconnect to switch later.
                      {selectable.length < workspaces.length ? " Workspaces without a mapped workday are not shown." : ""}
                    </p>
                  </div>
                ) : (
                  workspaceRow
                )}
              </>
            )}

            {approved ? workspaceRow : null}

            {!selectable.length ? (
              <ActionNotice>
                No Work OS workspace has a workday mapped to this account. Ask an administrator to map you before connecting this device.
              </ActionNotice>
            ) : null}
            {!requestValid && requestPresent ? (
              <ActionNotice>
                This authorization request is incomplete. Return to Work OS and choose Connect workspace again.
              </ActionNotice>
            ) : null}
            {failed && error ? <ActionNotice>{error}</ActionNotice> : null}

            <div className="mt-7 flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-end">
              {approved ? (
                <>
                  <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
                    <X size={15} aria-hidden="true" /> Close this tab
                  </button>
                  <button type="button" onClick={onOpenCompanion} disabled={!callbackUrl} className={PRIMARY_BUTTON}>
                    <ArrowUpRight size={16} aria-hidden="true" /> Open Work OS
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
                    <X size={15} aria-hidden="true" /> Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onApprove}
                    disabled={!canApprove}
                    aria-busy={working}
                    className={PRIMARY_BUTTON}
                  >
                    {working ? (
                      <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : (
                      <ShieldCheck size={16} aria-hidden="true" />
                    )}
                    {working ? "Authorizing…" : failed ? "Try again" : "Authorize device"}
                  </button>
                </>
              )}
            </div>

            {approved ? (
              <p className="mt-3 text-[11px] leading-5 text-[var(--text-secondary)] sm:text-right">
                If Work OS doesn&apos;t open, start it from the Start menu and choose Open Work OS again.{" "}
                <button
                  type="button"
                  onClick={restart}
                  className="font-semibold text-[var(--text-secondary)] underline decoration-[var(--border-hot)] underline-offset-4 hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  Authorize again
                </button>
              </p>
            ) : null}
          </div>

          <aside className="flex flex-col border-t border-[var(--border)] bg-[var(--bg-secondary)] p-6 sm:p-8 md:border-l md:border-t-0">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold text-[var(--text-secondary)]">Connection</p>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--text-secondary)]">
                <span className={`size-1.5 rounded-full ${dotTone}`} aria-hidden="true" />
                <span className={statusTone}>{statusLabel}</span>
              </span>
            </div>

            <div className="mt-7" aria-hidden="true">
              <div className={DEVICE_TILE}>
                <div className="flex items-center gap-2.5">
                  <span className={DEVICE_MARK}>
                    <Globe2 size={17} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-[var(--text-primary)]">This browser</p>
                    <p className="truncate text-[11px] text-[var(--text-secondary)]">{accountLabel}</p>
                  </div>
                </div>
              </div>

              <div className="relative mx-auto flex h-12 w-6 items-center justify-center">
                <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--border-hot)]" />
                <span
                  className={`absolute inset-y-0 left-1/2 w-px origin-top -translate-x-1/2 bg-[var(--accent)] transition-transform duration-300 motion-reduce:transition-none ${connectionLine}`}
                />
                <span
                  className={`relative flex size-6 items-center justify-center rounded-full border bg-[var(--bg-card)] transition-colors ${connectionTone}`}
                >
                  {approved ? (
                    <Check size={13} strokeWidth={3} />
                  ) : failed ? (
                    <AlertCircle size={12} />
                  ) : working ? (
                    <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Link2 size={12} />
                  )}
                </span>
              </div>

              <div className={DEVICE_TILE}>
                {approved ? (
                  <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-inverse)] shadow-[var(--shadow-sm)]">
                    <Check size={12} strokeWidth={3} />
                  </span>
                ) : null}
                <div className="flex items-center gap-2.5">
                  <span className={DEVICE_MARK}>
                    <Monitor size={17} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-[var(--text-primary)]">Work OS Companion</p>
                    <p className="truncate text-[11px] text-[var(--text-secondary)]">This PC</p>
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-auto pt-8 text-[11.5px] leading-5 text-[var(--text-secondary)]">
              {approved
                ? "The approval is waiting for the companion to collect it."
                : working
                  ? "Approving this device…"
                  : failed
                    ? "The approval didn't complete. Try again."
                    : "The companion is waiting for your approval in this browser."}
            </p>
          </aside>
        </div>
      </section>
    </main>
  );
}

export default function DesktopConnect({
  challenge,
  state,
  redirectUri,
  workspaces,
  accountLabel,
}: {
  challenge: string;
  state: string;
  redirectUri: string;
  workspaces: WorkOsWorkspaceChoice[];
  accountLabel: string;
}) {
  // A companion session is person-scoped. A workspace without a mapped person
  // cannot authorize this device, so it is not offered as a choice.
  const selectable = workspaces.filter((workspace) => Boolean(workspace.personId));
  const [organizationId, setOrganizationId] = useState(
    selectable.length === 1 ? selectable[0].organizationId : "",
  );
  const [status, setStatus] = useState<ConnectStatus>("idle");
  const [error, setError] = useState("");
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const requestValid = challenge.length >= 43 && state.length >= 16 && redirectUri === "wrazy-workos://auth";
  const requestPresent = Boolean(challenge || state || redirectUri);
  const selected = selectable.find((workspace) => workspace.organizationId === organizationId) ?? null;

  async function approve() {
    if (!requestValid || !selected || status === "working") return;
    setStatus("working");
    setError("");
    try {
      const response = await fetch("/api/work-os/desktop/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge,
          state,
          redirect_uri: redirectUri,
          organization_id: selected.organizationId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof result.error === "string" ? result.error : "Could not authorize this device.");
        setStatus("error");
        return;
      }
      if (typeof result.callbackUrl !== "string" || !result.callbackUrl) {
        setError("The authorization completed without a companion link. Return to Work OS and try again.");
        setStatus("error");
        return;
      }
      setCallbackUrl(result.callbackUrl);
      setStatus("authorized");
    } catch {
      setError("The authorization request could not be completed. Check your connection and try again.");
      setStatus("error");
    }
  }

  function openCompanion() {
    if (!callbackUrl) return;
    window.location.assign(callbackUrl);
  }

  function startOver() {
    setCallbackUrl(null);
    setError("");
    setStatus("idle");
  }

  return (
    <DesktopConnectView
      accountLabel={accountLabel}
      workspaces={workspaces}
      organizationId={organizationId}
      onOrganizationChange={setOrganizationId}
      requestValid={requestValid}
      requestPresent={requestPresent}
      status={status}
      error={error}
      callbackUrl={callbackUrl}
      onApprove={() => void approve()}
      onOpenCompanion={openCompanion}
      onStartOver={startOver}
      onClose={() => window.close()}
    />
  );
}
