"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, Layers3, Plus, Settings, ShieldCheck, Users } from "lucide-react";
import { adminFetch, adminKeys, type SystemStatusResponse } from "./api";
import {
  AdminCard,
  Button,
  EmptyState,
  Notice,
  ProvenanceChip,
  SectionHeading,
  SelectField,
  Skeleton,
  StateMark,
  StatusPill,
  TextField,
  statusLabel,
} from "./ui";

type AnyRow = Record<string, any>;

const FEATURES: Array<{ key: string; label: string; detail: string; comingSoon?: boolean }> = [
  { key: "employee_companion", label: "Employee companion", detail: "Check-ins, plans, and the employee workday record." },
  { key: "desktop_companion", label: "Windows companion", detail: "The installed desktop app with Worktivity attendance control." },
  { key: "screenshot_summaries", label: "Screenshot summaries", detail: "Sampled, encrypted activity context with 30-day retention." },
  { key: "github_evidence", label: "GitHub evidence", detail: "Attributed commits and pull requests as output evidence." },
  { key: "ghl_evidence", label: "GHL evidence", detail: "Attributed CRM events as output evidence.", comingSoon: true },
  { key: "voice_input", label: "Voice input & output", detail: "Record-to-transcribe updates in the composers, and hear recaps read back." },
  { key: "seo_mission_control", label: "SEO Mission Control", detail: "The SEO operations surface for this workspace." },
];

const SEMANTIC_FIELDS = [
  { value: "priority", label: "Priority" },
  { value: "blocked_reason", label: "Blocked reason" },
  { value: "estimated_effort_minutes", label: "Estimated effort" },
  { value: "expected_outcome", label: "Expected outcome" },
  { value: "definition_of_done", label: "Definition of done" },
];

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
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
  const fieldMappings = useQuery<{ mappings: AnyRow[] }>({
    queryKey: adminKeys.fieldMappings(),
    queryFn: () => adminFetch("/api/work-os/field-mappings"),
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
  const saveConnection = useMutation({
    mutationFn: (body: AnyRow) => adminFetch("/api/work-os/integrations/connections", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    onSuccess: invalidate,
  });
  const saveMapping = useMutation({
    mutationFn: (body: AnyRow) => adminFetch("/api/work-os/field-mappings", {
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
  const [teamName, setTeamName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teamPersonId, setTeamPersonId] = useState("");
  const [teamManager, setTeamManager] = useState(false);
  const [connectorProvider, setConnectorProvider] = useState("github");
  const [connectorWorkspaceId, setConnectorWorkspaceId] = useState("");
  const [connectorAccountId, setConnectorAccountId] = useState("");
  const [connectorPersonId, setConnectorPersonId] = useState("");
  const [mappingField, setMappingField] = useState("priority");
  const [mappingProviderFieldId, setMappingProviderFieldId] = useState("");
  const [blueprintClient, setBlueprintClient] = useState("");
  const [blueprintStart, setBlueprintStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [blueprintAssignee, setBlueprintAssignee] = useState("");

  const organizationFlags = (organization.data?.organization?.feature_flags ?? {}) as Record<string, boolean>;
  const personOptions = (people.data?.people ?? []).map((person) => ({ value: person.id, label: person.display_name }));
  const error = organization.error || connections.error || fieldMappings.error || blueprints.error || features.error || membershipAction.error || membershipPatch.error || saveConnection.error || saveMapping.error || generateBlueprint.error;

  return (
    <div className="grid gap-5">
      {error ? <Notice tone="err">{(error as Error).message}</Notice> : null}

      {/* System status */}
      <AdminCard>
        <SectionHeading icon={ShieldCheck} title="System status" detail="Schema, provider connectivity, and the runtime flags the workspace depends on." />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
          {status.isLoading ? <Skeleton className="h-6 w-40" /> : (
            <>
              <StateMark tone={status.data?.schema.ready ? "ok" : "warn"}>
                {status.data?.schema.ready ? "Work OS schema ready" : "Migration required"}
              </StateMark>
              <StateMark tone={status.data?.nifty.canCallApi ? "ok" : "warn"}>
                {status.data?.nifty.canCallApi ? "Nifty backup ready" : "Nifty backup not connected"}
              </StateMark>
              <StateMark tone={status.data?.nifty.hasRefreshToken ? "ok" : "neutral"}>
                {status.data?.nifty.hasRefreshToken ? "Refresh token present" : "No refresh token"}
              </StateMark>
            </>
          )}
        </div>
        {!status.data?.schema.ready && status.data ? (
          <p className="mt-3 text-[12px] leading-5 text-[var(--text-secondary)]">
            Apply the Work OS migration (<span className="font-mono text-[11px]">{status.data.schema.migration}</span>) before sync, evidence, and reports can run.
          </p>
        ) : null}
      </AdminCard>

      {/* Pilot features */}
      <AdminCard>
        <SectionHeading icon={Settings} title="Workspace features" detail="Pilot features enabled for the whole organization. Members can override the companion flags individually." />
        <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
          {FEATURES.map((feature) => (
            <li key={feature.key}>
              <label
                className={`flex items-center justify-between gap-4 py-3 first:pt-1 last:pb-1 ${feature.comingSoon ? "cursor-not-allowed" : "cursor-pointer"}`}
                aria-disabled={feature.comingSoon ? "true" : undefined}
              >
                <span className={`min-w-0 ${feature.comingSoon ? "blur-[2px] opacity-60 select-none" : ""}`} aria-hidden={feature.comingSoon ? "true" : undefined}>
                  <span className="block text-[12.5px] font-semibold text-[var(--text-primary)]">{feature.label}</span>
                  <span className="block text-[11px] text-[var(--text-tertiary)]">{feature.detail}</span>
                </span>
                {feature.comingSoon ? (
                  <StatusPill tone="neutral">Coming soon</StatusPill>
                ) : (
                  <input
                    type="checkbox"
                    checked={organizationFlags[feature.key] === true}
                    disabled={features.isPending}
                    onChange={(event) => features.mutate({ [feature.key]: event.target.checked })}
                  />
                )}
              </label>
              {feature.comingSoon ? <span className="sr-only">{feature.label} is coming soon and cannot be enabled yet.</span> : null}
            </li>
          ))}
        </ul>
      </AdminCard>

      {/* Memberships */}
      <AdminCard>
        <SectionHeading icon={Users} title="Memberships" detail="Who can use Work OS and with which role. Members must already have a WrazyOS account." />
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
        <ul className="mt-4 divide-y" style={{ borderColor: "var(--border-subtle)" }}>
          {(organization.data?.memberships ?? []).map((member) => (
            <li key={String(member.id)} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-1 last:pb-1">
              <span className="min-w-0 flex-1 basis-[200px]">
                <span className="block truncate text-[12.5px] font-semibold text-[var(--text-primary)]">
                  {member.person?.display_name || member.person?.email || String(member.user_id)}
                </span>
                <span className="block truncate text-[11px] text-[var(--text-tertiary)]">{member.person?.email ?? "No mapped person"}</span>
              </span>
              <select
                aria-label={`Role for ${member.person?.display_name ?? member.user_id}`}
                value={String(member.role)}
                onChange={(event) => membershipPatch.mutate({ membership_id: member.id, role: event.target.value })}
                className="min-h-[30px] rounded-lg border bg-transparent px-2 py-1 text-[11.5px] text-[var(--text-primary)]"
                style={{ borderColor: "var(--border)" }}
              >
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
              {(["employee_companion", "desktop_companion"] as const).map((key) => (
                <label key={key} className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={member.feature_flags?.[key] ?? organizationFlags[key] === true}
                    onChange={(event) => membershipPatch.mutate({ membership_id: member.id, feature_flags: { ...(member.feature_flags ?? {}), [key]: event.target.checked } })}
                  />
                  {key === "employee_companion" ? "Companion" : "Desktop"}
                </label>
              ))}
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={member.active !== false}
                  onChange={(event) => membershipPatch.mutate({ membership_id: member.id, active: event.target.checked })}
                />
                Active
              </label>
            </li>
          ))}
          {!organization.data?.memberships?.length && !organization.isLoading ? (
            <li className="py-2 text-[12px] text-[var(--text-tertiary)]">No memberships recorded yet.</li>
          ) : null}
        </ul>
      </AdminCard>

      {/* Teams */}
      <AdminCard>
        <SectionHeading icon={Users} title="Teams" detail="Teams scope manager review to their own members." />
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
          <label className="flex min-h-[34px] items-center gap-2 rounded-[10px] border px-3 text-[11.5px] text-[var(--text-secondary)]" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <input type="checkbox" checked={teamManager} onChange={(event) => setTeamManager(event.target.checked)} />
            Manager
          </label>
          <Button
            variant="primary"
            disabled={!teamId || !teamPersonId || membershipAction.isPending}
            onClick={() => membershipAction.mutate({ type: "team_member", team_id: teamId, person_id: teamPersonId, is_manager: teamManager })}
          >
            Assign
          </Button>
        </div>
        <ul className="mt-4 divide-y" style={{ borderColor: "var(--border-subtle)" }}>
          {(organization.data?.teams ?? []).map((team) => {
            const members = (organization.data?.teamMembers ?? []).filter((member) => member.team_id === team.id);
            return (
              <li key={String(team.id)} className="py-3 first:pt-1 last:pb-1">
                <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">{String(team.name)}</p>
                <p className="mt-0.5 text-[11.5px] text-[var(--text-tertiary)]">
                  {members.length
                    ? members.map((member) => `${member.person?.display_name ?? "Unknown"}${member.is_manager ? " (manager)" : ""}`).join(", ")
                    : "No members"}
                </p>
              </li>
            );
          })}
          {!organization.data?.teams?.length && !organization.isLoading ? (
            <li className="py-2 text-[12px] text-[var(--text-tertiary)]">No teams yet.</li>
          ) : null}
        </ul>
      </AdminCard>

      {/* Connections */}
      <AdminCard>
        <SectionHeading
          icon={Cable}
          title="Provider connections"
          detail="Workspace-level connections for evidence providers. Source accounts are only verified when mapped to a person."
          action={
            <a href="/api/work-os/nifty/oauth/start" className="inline-flex items-center rounded-[10px] border px-3 py-2 text-[11.5px] font-semibold text-[var(--text-primary)]" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
              Connect Nifty backup
            </a>
          }
        />
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            label="Provider"
            value={connectorProvider}
            onChange={setConnectorProvider}
            options={[
              { value: "github", label: "GitHub" },
              { value: "ghl", label: "GHL — coming soon", disabled: true },
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
          <p className="mt-2 text-[11.5px] leading-5 text-[var(--text-tertiary)]">
            Workspace: the GitHub organization login (for example <span className="font-mono">WrazyAI</span>) or its numeric id. Account: the GitHub username or numeric user id — a verified account attributes that person&apos;s commits, pull requests, reviews, and workflow runs.
          </p>
        ) : null}
        <ul className="mt-4 divide-y" style={{ borderColor: "var(--border-subtle)" }}>
          {(connections.data?.connections ?? []).map((connection) => (
            <li key={String(connection.id)} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-1 last:pb-1 text-[12px]">
              <span className="font-semibold text-[var(--text-primary)]">{String(connection.provider)}</span>
              <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{String(connection.external_workspace_id)}</span>
              <StateMark tone={connection.active === false ? "warn" : "ok"}>{connection.active === false ? "Inactive" : "Active"}</StateMark>
            </li>
          ))}
          {!connections.data?.connections?.length && !connections.isLoading ? (
            <li className="py-2 text-[12px] text-[var(--text-tertiary)]">No provider connections yet.</li>
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
      </AdminCard>

      {/* Field mappings */}
      <AdminCard>
        <SectionHeading icon={Layers3} title="Nifty custom fields" detail="Maps Work OS fields onto Nifty custom field IDs." />
        <div className="flex flex-wrap items-end gap-2">
          <SelectField label="Work OS field" value={mappingField} onChange={setMappingField} options={SEMANTIC_FIELDS} ariaLabel="Semantic field" />
          <TextField label="Nifty field ID" value={mappingProviderFieldId} onChange={setMappingProviderFieldId} ariaLabel="Nifty field ID" />
          <Button
            variant="primary"
            disabled={!mappingProviderFieldId.trim() || saveMapping.isPending}
            onClick={() => saveMapping.mutate({ provider: "nifty", semantic_field: mappingField, provider_field_id: mappingProviderFieldId.trim() }, { onSuccess: () => setMappingProviderFieldId("") })}
          >
            Save mapping
          </Button>
        </div>
        <ul className="mt-4 grid gap-1.5">
          {(fieldMappings.data?.mappings ?? []).map((mapping) => (
            <li key={String(mapping.id)} className="flex items-center justify-between gap-2 text-[12px] text-[var(--text-secondary)]">
              <span>{statusLabel(String(mapping.semantic_field))}</span>
              <span className="font-mono text-[11px] text-[var(--text-tertiary)]">{String(mapping.provider_field_id)}</span>
            </li>
          ))}
          {!fieldMappings.data?.mappings?.length && !fieldMappings.isLoading ? (
            <li className="text-[12px] text-[var(--text-tertiary)]">No field mappings recorded.</li>
          ) : null}
        </ul>
      </AdminCard>

      {/* Blueprints */}
      <AdminCard>
        <SectionHeading icon={Layers3} title="Blueprints" detail="Generate a structured task set from a blueprint for a new client or project." />
        <div className="flex flex-wrap items-end gap-2">
          <TextField label="Client / project name" value={blueprintClient} onChange={setBlueprintClient} ariaLabel="Blueprint client name" />
          <TextField label="Start date" type="date" value={blueprintStart} onChange={setBlueprintStart} ariaLabel="Blueprint start date" />
          <SelectField label="Assignee" value={blueprintAssignee} onChange={setBlueprintAssignee} options={personOptions} placeholder="Unassigned" ariaLabel="Blueprint assignee" />
        </div>
        {(blueprints.data?.blueprints ?? []).length ? (
          <ul className="mt-4 divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {blueprints.data!.blueprints.map((blueprint) => (
              <li key={String(blueprint.id)} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-1 last:pb-1">
                <span className="min-w-0 flex-1 basis-[240px]">
                  <span className="block text-[12.5px] font-semibold text-[var(--text-primary)]">{String(blueprint.name)}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-5 text-[var(--text-tertiary)]">{String(blueprint.description ?? "")}</span>
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
        {generateBlueprint.isSuccess ? <Notice tone="ok">Tasks were generated from the blueprint.</Notice> : null}
      </AdminCard>

      <p className="text-[11px] leading-5 text-[var(--text-tertiary)]">
        Need the workspace migration or readiness audit? Run <span className="font-mono">npm run work-os:pilot-audit</span> against the deployment.{" "}
        <Link href="/work-os/admin" className="font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">Back to overview</Link>
      </p>
    </div>
  );
}
