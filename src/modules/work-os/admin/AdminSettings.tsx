"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Layers3, Plus, Search } from "lucide-react";
import AdminAgentAccess from "./AdminAgentAccess";
import { adminFetch, adminKeys, type SystemStatusResponse } from "./api";
import {
  Button,
  EmptyState,
  Group,
  Notice,
  ProvenanceChip,
  SelectField,
  Skeleton,
  StateMark,
  StatusPill,
  Switch,
  TextField,
} from "./ui";

type AnyRow = Record<string, any>;

const FEATURES: Array<{ key: string; label: string; detail: string; comingSoon?: boolean }> = [
  { key: "employee_companion", label: "Employee companion", detail: "Check-ins, plans, and the employee workday record." },
  { key: "admin_agent_api", label: "Admin agent API", detail: "Token-scoped admin reads, task actions, EOD review, and MCP." },
  { key: "desktop_companion", label: "Windows companion", detail: "The installed desktop app with Worktivity attendance control." },
  { key: "screenshot_summaries", label: "Screenshot summaries", detail: "Sampled, encrypted activity context with 30-day retention." },
  { key: "github_evidence", label: "GitHub evidence", detail: "Attributed commits and pull requests as output evidence." },
  { key: "ghl_evidence", label: "GoHighLevel evidence", detail: "Read-only PIT polling for attributable calls, messages, email, appointments and CRM activity." },
  { key: "voice_input", label: "Voice input & output", detail: "Record-to-transcribe updates in the composers, and hear recaps read back." },
  { key: "seo_mission_control", label: "SEO Mission Control", detail: "The SEO operations surface for this workspace." },
];

type MemberPasswordResetResult = {
  sent: true;
  membershipId: string;
  email: string;
  sentAt: string;
  expiresAt: string;
  emailId: string | null;
};

function formatResetSentTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const confirmTitleId = useId();
  const confirmDialogRef = useRef<HTMLDialogElement | null>(null);
  const confirmPressedOutside = useRef(false);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["work-os"] });

  const organization = useQuery<{ organization: AnyRow; memberships: AnyRow[]; teams: AnyRow[]; teamMembers: AnyRow[] }>({
    queryKey: adminKeys.organization(),
    queryFn: () => adminFetch("/api/work-os/organization"),
    staleTime: 30_000,
  });
  const connections = useQuery<{ connections: AnyRow[]; accounts: AnyRow[] }>({
    queryKey: adminKeys.connections(),
    queryFn: () => adminFetch("/api/work-os/integrations/connections"),
    staleTime: 30_000,
  });
  const blueprints = useQuery<{ blueprints: AnyRow[] }>({
    queryKey: adminKeys.blueprints(),
    queryFn: () => adminFetch("/api/work-os/blueprints"),
    staleTime: 60_000,
  });
  const status = useQuery<SystemStatusResponse>({
    queryKey: adminKeys.status(),
    queryFn: () => adminFetch<SystemStatusResponse>("/api/work-os/status"),
    staleTime: 30_000,
  });
  const people = useQuery<{ people: Array<{ id: string; display_name: string }> }>({
    queryKey: adminKeys.people(),
    queryFn: () => adminFetch("/api/work-os/people"),
    staleTime: 60_000,
  });

  const features = useMutation({
    mutationFn: (featureFlags: Record<string, boolean>) => adminFetch("/api/work-os/organization", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature_flags: featureFlags }),
    }),
    onSuccess: invalidate,
  });
  const membershipAction = useMutation({
    mutationFn: (body: AnyRow) => adminFetch("/api/work-os/organization", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: invalidate,
  });
  const membershipPatch = useMutation({
    mutationFn: (body: AnyRow) => adminFetch("/api/work-os/organization", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: invalidate,
  });
  const passwordReset = useMutation({
    mutationFn: (member: AnyRow) =>
      adminFetch<MemberPasswordResetResult>(`/api/work-os/organization/members/${encodeURIComponent(String(member.id))}/password-reset`, {
        method: "POST",
      }),
    onSuccess: (result) => {
      setSentResets((previous) => ({
        ...previous,
        [result.membershipId]: { sentAt: result.sentAt, email: result.email },
      }));
      setLastResetReceipt(`Sent a 1-hour password reset link to ${result.email}.`);
    },
  });
  const saveConnection = useMutation({
    mutationFn: (body: AnyRow) => adminFetch("/api/work-os/integrations/connections", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: invalidate,
  });
  const generateBlueprint = useMutation({
    mutationFn: ({ id, body }: { id: string; body: AnyRow }) => adminFetch(`/api/work-os/blueprints/${id}/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: invalidate,
  });

  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState("employee");
  const [memberQuery, setMemberQuery] = useState("");
  const [confirmResetMember, setConfirmResetMember] = useState<AnyRow | null>(null);
  const [sentResets, setSentResets] = useState<Record<string, { sentAt: string; email: string }>>({});
  const [lastResetReceipt, setLastResetReceipt] = useState<string | null>(null);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!confirmResetMember || !dialog) return;
    if (!dialog.open) dialog.showModal();
  }, [confirmResetMember]);
  const [teamName, setTeamName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teamPersonId, setTeamPersonId] = useState("");
  const [teamManager, setTeamManager] = useState(false);
  const [connectorProvider, setConnectorProvider] = useState("github");
  const [connectorWorkspaceId, setConnectorWorkspaceId] = useState("");
  const [connectorAccountId, setConnectorAccountId] = useState("");
  const [connectorPersonId, setConnectorPersonId] = useState("");
  const [blueprintClient, setBlueprintClient] = useState("");
  const [blueprintStart, setBlueprintStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [blueprintAssignee, setBlueprintAssignee] = useState("");

  const organizationFlags = (organization.data?.organization?.feature_flags ?? {}) as Record<string, boolean>;
  const personOptions = (people.data?.people ?? []).map((person) => ({ value: person.id, label: person.display_name }));
  const error = organization.error || connections.error || blueprints.error || features.error || membershipAction.error || membershipPatch.error || passwordReset.error || saveConnection.error || generateBlueprint.error;

  const memberships = useMemo(() => {
    const list = organization.data?.memberships ?? [];
    const needle = memberQuery.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((member) => `${member.person?.display_name ?? ""} ${member.email ?? ""} ${member.person?.email ?? ""} ${member.user_id ?? ""}`.toLowerCase().includes(needle));
  }, [organization.data, memberQuery]);

  return (
    <div className="flex flex-col">
      {error ? <div className="pb-4"><Notice tone="err">{(error as Error).message}</Notice></div> : null}

      <Group label="System" detail="Schema, provider connectivity, and runtime flags.">
        {status.isLoading ? <Skeleton className="h-6 w-40" /> : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <StateMark tone={status.data?.schema.ready ? "ok" : "warn"}>
              {status.data?.schema.ready ? "Work OS schema ready" : "Migration required"}
            </StateMark>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {status.data?.schema.ready ? "Sync, evidence, and reports can run." : "Sync, evidence, and reports are paused until the migration is applied."}
            </span>
          </div>
        )}
        {!status.data?.schema.ready && status.data ? (
          <p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">
            Apply the Work OS migration (<span className="font-mono text-[11px]">{status.data.schema.migration}</span>) before sync, evidence, and reports can run.
          </p>
        ) : null}
      </Group>

      <Group label="Features" detail="Pilot features for the whole organization. Members can override the companion flags individually.">
        <ul>
          {FEATURES.map((feature) => (
            <li key={feature.key} className="flex items-center justify-between gap-4 border-b py-2.5 last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-[var(--text-primary)]">{feature.label}</span>
                <span className="block text-[11px] leading-4 text-[var(--text-tertiary)]">{feature.detail}</span>
              </span>
              {feature.comingSoon ? (
                <span className="flex shrink-0 items-center gap-2" aria-disabled="true">
                  <StatusPill tone="neutral">Coming soon</StatusPill>
                </span>
              ) : (
                <Switch
                  checked={organizationFlags[feature.key] === true}
                  disabled={features.isPending}
                  ariaLabel={`${feature.label} for this workspace`}
                  onChange={(next) => features.mutate({ [feature.key]: next })}
                />
              )}
            </li>
          ))}
        </ul>
      </Group>

      <Group label="Agent access" detail="Scoped admin tokens for external agents.">
        {!organization.isLoading ? (
          organizationFlags.admin_agent_api === true ? (
            <AdminAgentAccess />
          ) : (
            <p className="text-[11.5px] leading-5 text-[var(--text-tertiary)]">
              Admin agent access is off. Enable <span className="font-semibold text-[var(--text-secondary)]">Admin agent API</span> above to mint admin-scoped tokens.
            </p>
          )
        ) : null}
      </Group>

      <Group label="Memberships" detail="Who can use Work OS and with which role. Members must already have a WrazyOS account.">
        <div className="flex flex-wrap items-end gap-2">
          <TextField label="User email" value={memberEmail} onChange={setMemberEmail} placeholder="employee@company.com" ariaLabel="Member email" className="min-w-[220px]" />
          <SelectField
            label="Role"
            value={memberRole}
            onChange={setMemberRole}
            options={[
              { value: "employee", label: "Employee" },
              { value: "manager", label: "Manager" },
              { value: "admin", label: "Admin" },
            ]}
            ariaLabel="Member role"
          />
          <Button
            variant="primary"
            disabled={!memberEmail.trim() || membershipAction.isPending}
            onClick={() => membershipAction.mutate({ type: "membership", email: memberEmail.trim(), role: memberRole }, { onSuccess: () => setMemberEmail("") })}
          >
            Add or update
          </Button>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <label className="relative block w-full sm:w-[240px]">
            <span className="sr-only">Search members</span>
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" aria-hidden />
            <input
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder="Name or email"
              className="min-h-[32px] w-full rounded-[8px] border pl-8 pr-2.5 py-1 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              style={{ borderColor: "var(--border)", background: "var(--color-paper)" }}
            />
          </label>
          <span className="shrink-0 text-[10.5px] text-[var(--text-tertiary)]">
            {(organization.data?.memberships ?? []).length} member{(organization.data?.memberships ?? []).length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-2 hidden gap-3 border-b pb-2 text-[10px] font-medium text-[var(--text-tertiary)] md:grid md:grid-cols-[minmax(0,1fr)_108px_72px_60px_52px_124px]" style={{ borderColor: "var(--border-subtle)" }}>
          <span>Person</span>
          <span>Role</span>
          <span>Companion</span>
          <span>Desktop</span>
          <span>Active</span>
          <span className="text-right">Password</span>
        </div>
        <ul>
          {memberships.map((member) => {
            const label = member.person?.display_name ?? member.email ?? member.person?.email ?? member.user_id;
            const loginEmail = member.email ?? member.person?.email ?? null;
            const isActive = member.active !== false;
            const sentRecord = sentResets[String(member.id)];
            const isSendingThis = passwordReset.isPending && String(passwordReset.variables?.id) === String(member.id);
            return (
              <li key={String(member.id)} className="grid gap-x-3 gap-y-2 border-b py-2.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_108px_72px_60px_52px_124px] md:items-center" style={{ borderColor: "var(--border-subtle)" }}>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold text-[var(--text-primary)]">
                    {member.person?.display_name || loginEmail || String(member.user_id)}
                  </span>
                  <span className="block truncate text-[10.5px] text-[var(--text-tertiary)]">{loginEmail ?? "No mapped person"}</span>
                </span>
                <select
                  aria-label={`Role for ${label}`}
                  value={String(member.role)}
                  onChange={(event) => membershipPatch.mutate({ membership_id: member.id, role: event.target.value })}
                  className="min-h-[30px] rounded-[8px] border bg-transparent px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
                  style={{ borderColor: "var(--border)" }}
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
                {(["employee_companion", "desktop_companion"] as const).map((key) => (
                  <span key={key} className="flex items-center gap-1.5">
                    <Switch
                      ariaLabel={`${key === "employee_companion" ? "Companion" : "Desktop"} for ${label}`}
                      checked={member.feature_flags?.[key] ?? organizationFlags[key] === true}
                      onChange={(next) => membershipPatch.mutate({ membership_id: member.id, feature_flags: { ...(member.feature_flags ?? {}), [key]: next } })}
                    />
                    <span className="text-[10.5px] text-[var(--text-tertiary)] md:hidden">{key === "employee_companion" ? "Companion" : "Desktop"}</span>
                  </span>
                ))}
                <span className="flex items-center gap-1.5">
                  <Switch
                    ariaLabel={`Active for ${label}`}
                    checked={isActive}
                    onChange={(next) => membershipPatch.mutate({ membership_id: member.id, active: next })}
                  />
                  <span className="text-[10.5px] text-[var(--text-tertiary)] md:hidden">Active</span>
                </span>
                <span className="flex items-center gap-2 md:justify-end">
                  {!isActive ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled
                      title="Activate this member before sending a password reset email"
                      aria-label={`Password reset unavailable for inactive member ${label}`}
                    >
                      Inactive
                    </Button>
                  ) : isSendingThis ? (
                    <Button size="sm" variant="secondary" disabled>
                      <KeyRound size={12} aria-hidden /> Sending…
                    </Button>
                  ) : sentRecord ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-[11px] font-medium" style={{ color: "var(--status-ok)" }}>
                        Sent {formatResetSentTime(sentRecord.sentAt)}
                      </span>
                      <button
                        type="button"
                        disabled={passwordReset.isPending}
                        onClick={() => {
                          passwordReset.reset();
                          setLastResetReceipt(null);
                          setConfirmResetMember(member);
                        }}
                        className="min-h-[34px] text-[11px] font-medium text-[var(--text-tertiary)] underline underline-offset-2 transition hover:text-[var(--text-primary)] disabled:opacity-50"
                      >
                        Resend
                      </button>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={passwordReset.isPending}
                      aria-label={`Send password reset email to ${label}`}
                      onClick={() => {
                        passwordReset.reset();
                        setLastResetReceipt(null);
                        setConfirmResetMember(member);
                      }}
                    >
                      <KeyRound size={12} aria-hidden /> Send reset
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
          {!memberships.length && !organization.isLoading ? (
            <li className="py-3 text-[12px] text-[var(--text-tertiary)]">
              {memberQuery ? "No members match that search." : "No memberships recorded yet."}
            </li>
          ) : null}
        </ul>
        {lastResetReceipt ? <div className="mt-3"><Notice tone="ok">{lastResetReceipt}</Notice></div> : null}
        {confirmResetMember ? (
          <dialog
            ref={confirmDialogRef}
            aria-labelledby={confirmTitleId}
            {...({ closedby: "any" } as Record<string, string>)}
            className="work-os-confirm-dialog m-auto w-[min(440px,calc(100vw-32px))] rounded-[16px] border p-0 text-[var(--text-primary)] shadow-xl"
            style={{ borderColor: "var(--border)", background: "var(--color-paper)" }}
            onPointerDown={(event) => {
              if (typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype) return;
              const rect = event.currentTarget.getBoundingClientRect();
              confirmPressedOutside.current =
                event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
            }}
            onPointerUp={(event) => {
              if (typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const releasedOutside =
                event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
              if (confirmPressedOutside.current && releasedOutside) event.currentTarget.close("");
              confirmPressedOutside.current = false;
            }}
            onClose={(event) => {
              const dialog = event.currentTarget;
              const choice = dialog.returnValue;
              dialog.returnValue = "";
              const target = confirmResetMember;
              setConfirmResetMember(null);
              if (choice === "confirm" && target) {
                passwordReset.mutate(target);
              }
            }}
          >
            <div className="flex flex-col gap-3.5 p-5">
              <h1 id={confirmTitleId} className="m-0 text-[16px] font-semibold tracking-[-0.015em] text-[var(--text-primary)]">
                Send password reset email?
              </h1>
              <p className="m-0 text-[12.5px] leading-5 text-[var(--text-secondary)]">
                This sends a one-time link to choose a new WrazyOS password. Their current password stays unchanged until they complete the reset.
              </p>
              <dl className="m-0 flex flex-col gap-2 rounded-[10px] border px-3.5 py-3 text-[12px]" style={{ borderColor: "var(--border)", background: "var(--color-canvas)" }}>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[var(--text-tertiary)]">Member</dt>
                  <dd className="m-0 text-right font-semibold text-[var(--text-primary)]">
                    {confirmResetMember.person?.display_name || confirmResetMember.email || confirmResetMember.person?.email || "Workspace member"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[var(--text-tertiary)]">Sign-in email</dt>
                  <dd className="m-0 break-all text-right font-mono text-[11.5px] font-semibold text-[var(--text-primary)]">
                    {confirmResetMember.email || confirmResetMember.person?.email || "Resolved from account"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[var(--text-tertiary)]">Link expiry</dt>
                  <dd className="m-0 text-right font-semibold text-[var(--text-primary)]">1 hour</dd>
                </div>
              </dl>
              <form method="dialog" className="flex items-center justify-end gap-2 pt-1">
                <Button type="submit" value="cancel" variant="secondary" autoFocus>
                  Cancel
                </Button>
                <Button type="submit" value="confirm" variant="primary">
                  Send reset email
                </Button>
              </form>
            </div>
          </dialog>
        ) : null}
      </Group>

      <Group label="Teams" detail="Teams scope manager review to their own members.">
        <div className="flex flex-wrap items-end gap-2">
          <TextField label="New team name" value={teamName} onChange={setTeamName} ariaLabel="New team name" className="min-w-[200px]" />
          <Button
            disabled={!teamName.trim() || membershipAction.isPending}
            onClick={() => membershipAction.mutate({ type: "team", name: teamName.trim() }, { onSuccess: () => setTeamName("") })}
          >
            <Plus size={13} aria-hidden /> Create team
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <SelectField label="Team" value={teamId} onChange={setTeamId} options={(organization.data?.teams ?? []).map((team) => ({ value: String(team.id), label: String(team.name) }))} placeholder="Select a team" ariaLabel="Team" />
          <SelectField label="Person" value={teamPersonId} onChange={setTeamPersonId} options={personOptions} placeholder="Select a person" ariaLabel="Team member" />
          <span className="flex min-h-[34px] items-center rounded-[8px] border px-2.5" style={{ borderColor: "var(--border)", background: "var(--color-paper)" }}>
            <Switch checked={teamManager} onChange={setTeamManager} label="Manager" />
          </span>
          <Button
            variant="primary"
            disabled={!teamId || !teamPersonId || membershipAction.isPending}
            onClick={() => membershipAction.mutate({ type: "team_member", team_id: teamId, person_id: teamPersonId, is_manager: teamManager })}
          >
            Assign
          </Button>
        </div>
        <ul className="mt-4">
          {(organization.data?.teams ?? []).map((team) => {
            const members = (organization.data?.teamMembers ?? []).filter((member) => member.team_id === team.id);
            return (
              <li key={String(team.id)} className="border-b py-2.5 last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
                <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">{String(team.name)}</p>
                <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
                  {members.length
                    ? members.map((member) => `${member.person?.display_name ?? "Unknown"}${member.is_manager ? " (manager)" : ""}`).join(", ")
                    : "No members"}
                </p>
              </li>
            );
          })}
          {!organization.data?.teams?.length && !organization.isLoading ? (
            <li className="py-2.5 text-[12px] text-[var(--text-tertiary)]">No teams yet.</li>
          ) : null}
        </ul>
      </Group>

      <Group label="Connections" detail="Workspace providers. Source accounts are only verified when mapped to a person.">
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            label="Provider"
            value={connectorProvider}
            onChange={setConnectorProvider}
            options={[
              { value: "github", label: "GitHub" },
              { value: "ghl", label: "GoHighLevel" },
              { value: "worktivity", label: "Worktivity" },
            ]}
            ariaLabel="Provider"
          />
          <TextField label="Workspace ID" value={connectorWorkspaceId} onChange={setConnectorWorkspaceId} ariaLabel="Provider workspace ID" />
          <TextField label="Account ID" value={connectorAccountId} onChange={setConnectorAccountId} ariaLabel="Source account ID" />
          <SelectField label="Mapped person" value={connectorPersonId} onChange={setConnectorPersonId} options={personOptions} placeholder="Unattributed" ariaLabel="Mapped person" />
          <Button
            variant="primary"
            disabled={!connectorWorkspaceId.trim() || saveConnection.isPending}
            onClick={() => saveConnection.mutate({
              provider: connectorProvider,
              external_workspace_id: connectorWorkspaceId.trim(),
              accounts: connectorAccountId.trim() ? [{
                external_account_id: connectorAccountId.trim(),
                person_id: connectorPersonId || null,
                verified: !!connectorPersonId,
                metadata: { login: connectorAccountId.trim() },
              }] : [],
            }, {
              onSuccess: () => { setConnectorWorkspaceId(""); setConnectorAccountId(""); setConnectorPersonId(""); },
            })}
          >
            Save connection
          </Button>
        </div>
        {connectorProvider === "github" ? (
          <p className="mt-2 text-[11px] leading-5 text-[var(--text-tertiary)]">
            Workspace: the GitHub organization login (for example <span className="font-mono">WrazyAI</span>) or its numeric id. Account: the GitHub username or numeric user id — a verified account attributes that person&apos;s commits, pull requests, reviews, and workflow runs.
          </p>
        ) : null}
        <ul className="mt-4">
          {(connections.data?.connections ?? []).map((connection) => (
            <li key={String(connection.id)} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b py-2.5 text-[12px] last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="font-semibold capitalize text-[var(--text-primary)]">{String(connection.provider)}</span>
              <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{String(connection.external_workspace_id)}</span>
              <StateMark tone={connection.active === false ? "warn" : "ok"}>{connection.active === false ? "Inactive" : "Active"}</StateMark>
            </li>
          ))}
          {!connections.data?.connections?.length && !connections.isLoading ? (
            <li className="py-2.5 text-[12px] text-[var(--text-tertiary)]">No provider connections yet.</li>
          ) : null}
        </ul>
        {(connections.data?.accounts ?? []).length ? (
          <ul className="mt-3 grid gap-2 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
            {connections.data!.accounts.map((account) => (
              <li key={String(account.id)} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--text-secondary)]">
                <ProvenanceChip>{String(account.provider)}</ProvenanceChip>
                <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{String(account.external_account_id)}</span>
                <span>{account.person?.display_name ?? "Unattributed"}</span>
                <StateMark tone={account.verified ? "ok" : "warn"}>{account.verified ? "Verified" : "Unverified"}</StateMark>
              </li>
            ))}
          </ul>
        ) : null}
      </Group>

      <Group label="Blueprints" detail="Generate a structured task set for a new client or project.">
        <div className="flex flex-wrap items-end gap-2">
          <TextField label="Client / project name" value={blueprintClient} onChange={setBlueprintClient} ariaLabel="Blueprint client name" />
          <TextField label="Start date" type="date" value={blueprintStart} onChange={setBlueprintStart} ariaLabel="Blueprint start date" />
          <SelectField label="Assignee" value={blueprintAssignee} onChange={setBlueprintAssignee} options={personOptions} placeholder="Unassigned" ariaLabel="Blueprint assignee" />
        </div>
        {(blueprints.data?.blueprints ?? []).length ? (
          <ul className="mt-4">
            {blueprints.data!.blueprints.map((blueprint) => (
              <li key={String(blueprint.id)} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b py-3 last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
                <span className="min-w-0 flex-1 basis-[240px]">
                  <span className="block text-[12.5px] font-semibold text-[var(--text-primary)]">{String(blueprint.name)}</span>
                  <span className="mt-0.5 block text-[11px] leading-5 text-[var(--text-tertiary)]">{String(blueprint.description ?? "")}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!blueprintClient.trim() || generateBlueprint.isPending}
                  onClick={() => generateBlueprint.mutate({ id: String(blueprint.id), body: { client_name: blueprintClient.trim(), start_date: blueprintStart, assignee_person_ids: blueprintAssignee ? [blueprintAssignee] : [] } })}
                >
                  Generate tasks
                </Button>
              </li>
            ))}
          </ul>
        ) : blueprints.isLoading ? (
          <Skeleton className="mt-4 h-20 w-full" />
        ) : (
          <div className="mt-4">
            <EmptyState icon={Layers3} title="No blueprints yet" body="Blueprints are stored per workspace owner. Add one from the workspace tooling to generate task sets." />
          </div>
        )}
        {generateBlueprint.isSuccess ? <div className="mt-3"><Notice tone="ok">Tasks were generated from the blueprint.</Notice></div> : null}
      </Group>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-[10.5px] leading-5 text-[var(--text-tertiary)]" style={{ borderColor: "var(--border)" }}>
        <span>
          Need the workspace migration or readiness audit? Run <span className="font-mono">npm run work-os:pilot-audit</span> against the deployment.
        </span>
        <Link href="/work-os/admin" className="font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">Back to overview</Link>
      </div>
    </div>
  );
}
