import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, PlugZap, RefreshCw, ShieldCheck, Users, UsersRound } from "lucide-react";
import { useNotifications } from "../NotificationFlyouts";
import { ADMIN_STATUS_DEGRADED_KEY, adminRoleLabel, niftySyncReceipt, workspaceDegradedNotice } from "./adminNotifications";
import {
  adminKeys,
  ADMIN_STALE_MS,
  fetchBlueprints,
  fetchConnections,
  fetchFieldMappings,
  fetchOrganization,
  fetchPeople,
  fetchSystemStatus,
  normalizeBlueprints,
  normalizeConnections,
  normalizeFieldMappings,
  normalizeOrganization,
  normalizePeople,
  normalizeSystemStatus,
  organizationAction,
  organizationMembershipPatch,
  relativeTime,
  saveOrganizationFeatures,
  statusLabel,
  syncNiftyTasks,
} from "./data";
import { AdminButton, AdminCard, Notice, Pill, SelectField, Skeleton, TextField } from "./ui";

const FEATURES: Array<{ key: string; label: string; detail: string }> = [
  { key: "employee_companion", label: "Employee workspace", detail: "Plans, updates, EOD reports, and the employee companion login." },
  { key: "desktop_companion", label: "Desktop companion", detail: "The installed app, device sessions, and update delivery." },
  { key: "screenshot_summaries", label: "Screenshot summaries", detail: "Worktivity frame summaries and retained frames behind the flagged/disputed rule." },
  { key: "github_evidence", label: "GitHub evidence", detail: "Commits, pull requests, reviews, and workflow runs become output evidence." },
  { key: "ghl_evidence", label: "GoHighLevel evidence", detail: "Opportunity and appointment activity becomes output evidence." },
  { key: "seo_mission_control", label: "SEO mission control", detail: "The SEO operations surfaces inside the console." },
  { key: "voice_input", label: "Voice input", detail: "Record → transcribe → review in the composers." },
];

/** Workspace settings: what the organization has switched on, who belongs to
 * it, and the provider connections that feed the record. Credentials and
 * mapping writes stay in the web console; the desktop reads their state. */
export default function SettingsPage() {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState("employee");
  const [teamName, setTeamName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teamPersonId, setTeamPersonId] = useState("");
  const [teamManager, setTeamManager] = useState(false);

  const organization = useQuery({ queryKey: adminKeys.organization(), queryFn: fetchOrganization, select: normalizeOrganization, staleTime: ADMIN_STALE_MS });
  const status = useQuery({ queryKey: adminKeys.status(), queryFn: fetchSystemStatus, select: normalizeSystemStatus, staleTime: ADMIN_STALE_MS });
  const connections = useQuery({ queryKey: adminKeys.connections(), queryFn: fetchConnections, select: normalizeConnections, staleTime: ADMIN_STALE_MS });
  const mappings = useQuery({ queryKey: adminKeys.fieldMappings(), queryFn: fetchFieldMappings, select: normalizeFieldMappings, staleTime: ADMIN_STALE_MS });
  const blueprints = useQuery({ queryKey: adminKeys.blueprints(), queryFn: fetchBlueprints, select: normalizeBlueprints, staleTime: ADMIN_STALE_MS });
  const people = useQuery({ queryKey: adminKeys.people(), queryFn: fetchPeople, select: normalizePeople, staleTime: ADMIN_STALE_MS });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["work-os", "admin"] });
  // Receipts name exactly the persisted outcome: the feature the response saved,
  // the member the patch targeted, or the counts the sync response reported.
  const features = useMutation({
    mutationFn: (next: Record<string, boolean>) => saveOrganizationFeatures(next),
    onSuccess: (_result, variables) => {
      invalidate();
      const changed = Object.entries(variables)[0];
      const feature = FEATURES.find((entry) => entry.key === changed?.[0]);
      if (feature && changed) {
        notifications.success(`“${feature.label}” is now ${changed[1] ? "on" : "off"} for every member.`, changed[1] ? "Feature turned on" : "Feature turned off");
      }
    },
  });
  const membership = useMutation({
    mutationFn: (body: Record<string, unknown>) => organizationMembershipPatch(body),
    onSuccess: (_result, variables) => {
      invalidate();
      const memberId = String(variables.membership_id ?? "");
      const member = (organization.data?.memberships ?? []).find((entry) => String(entry.id) === memberId);
      const name = member?.person?.display_name ?? member?.person?.email ?? "The member";
      if (typeof variables.role === "string") {
        notifications.success(`${name} is now ${adminRoleLabel(variables.role)}.`, "Member role changed");
      } else if (typeof variables.active === "boolean") {
        notifications.success(`${name} is now ${variables.active ? "active" : "inactive"} in this workspace.`, variables.active ? "Member activated" : "Member deactivated");
      }
    },
  });
  const action = useMutation({
    mutationFn: (body: Record<string, unknown>) => organizationAction(body),
    onSuccess: (result, variables) => {
      invalidate();
      if (variables.type === "membership") {
        notifications.success(`${String(variables.email)} was added as ${adminRoleLabel(String(variables.role ?? ""))}.`, "Member added");
      } else if (variables.type === "team") {
        const team = (result as { team?: { name?: string } } | undefined)?.team;
        notifications.success(`“${team?.name ?? String(variables.name ?? "The team")}” is ready for members.`, "Team created");
      } else if (variables.type === "team_member") {
        const person = (people.data?.people ?? []).find((entry) => String(entry.id) === String(variables.person_id));
        const team = teams.find((entry) => String(entry.id) === String(variables.team_id));
        const manager = variables.is_manager === true ? " as a team manager" : "";
        notifications.success(`${String(person?.display_name ?? "The teammate")} was added to ${String(team?.name ?? "the team")}${manager}.`, "Team member added");
      }
    },
  });
  // The sync is fire-and-forget — the operator presses it and moves on — so its
  // failure raises a flyout as well; the card's inline notice stays for retry.
  const sync = useMutation({
    mutationFn: () => syncNiftyTasks(),
    onSuccess: (result) => {
      invalidate();
      notifications.success(niftySyncReceipt(result), "Nifty sync finished");
    },
    onError: (error) => notifications.error((error as Error).message, "Nifty sync failed"),
  });

  // One standing condition for this page: the workspace status endpoint says
  // the schema or the Nifty connection is degraded. Stable key, cleared when
  // the status is healthy again.
  const degraded = workspaceDegradedNotice(status.data);
  const degradedTitle = degraded?.title ?? null;
  const degradedMessage = degraded?.message ?? null;
  useEffect(() => {
    if (!degradedTitle || !degradedMessage) {
      notifications.clearPersistent(ADMIN_STATUS_DEGRADED_KEY);
      return;
    }
    notifications.persistent(ADMIN_STATUS_DEGRADED_KEY, degradedMessage, degradedTitle, "warning");
  }, [degradedTitle, degradedMessage, notifications]);

  const error = organization.error || status.error || connections.error || mappings.error || blueprints.error || features.error || membership.error || action.error;
  const flags = (organization.data?.organization?.feature_flags ?? {}) as Record<string, boolean>;
  const memberships = organization.data?.memberships ?? [];
  const teams = organization.data?.teams ?? [];
  const teamMembers = organization.data?.teamMembers ?? [];
  const personOptions = (people.data?.people ?? []).map((person) => ({ value: String(person.id), label: String(person.display_name ?? "Unnamed") }));
  const teamOptions = teams.map((team) => ({ value: String(team.id), label: String(team.name ?? "Team") }));

  return (
    <div className="admin-grid">
      {error ? <Notice tone="err">{(error as Error).message}</Notice> : null}

      <AdminCard
        icon={ShieldCheck}
        title="Workspace status"
        detail="Schema readiness and the Nifty connection behind the task record"
        action={
          <AdminButton variant="secondary" icon={RefreshCw} disabled={sync.isPending || !status.data?.schema?.ready} onClick={() => sync.mutate()}>
            {sync.isPending ? "Syncing…" : "Sync Nifty"}
          </AdminButton>
        }
      >
        {status.isLoading || organization.isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <div className="admin-chips">
            <Pill tone={status.data?.schema?.ready ? "ok" : "warn"}>{status.data?.schema?.ready ? "Work OS schema ready" : "Migration required"}</Pill>
            <Pill tone={status.data?.nifty?.canCallApi ? "ok" : "warn"}>{status.data?.nifty?.canCallApi ? "Nifty connected" : "Nifty needs a connection"}</Pill>
            <Pill>{organization.data?.organization?.name ?? "Workspace"}</Pill>
            <Pill>slug {organization.data?.organization?.slug || "—"}</Pill>
          </div>
        )}
        {sync.error ? <Notice tone="err">{(sync.error as Error).message}</Notice> : null}
      </AdminCard>

      <AdminCard icon={PlugZap} title="Features" detail="One switch per workspace capability; changes apply to every member">
        <ul className="admin-feature-list">
          {FEATURES.map((feature) => (
            <li key={feature.key}>
              <span className="min-w-0"><b>{feature.label}</b><small>{feature.detail}</small></span>
              <label className="admin-toggle">
                <input
                  type="checkbox"
                  checked={flags[feature.key] === true}
                  disabled={features.isPending}
                  onChange={(event) => features.mutate({ [feature.key]: event.target.checked })}
                />
                <span aria-hidden />
                <em>{flags[feature.key] === true ? "On" : "Off"}</em>
              </label>
            </li>
          ))}
        </ul>
      </AdminCard>

      <AdminCard icon={Users} title="Members" detail={`${memberships.length} member${memberships.length === 1 ? "" : "s"} · roles decide which workspace each person can open`}>
        <div className="admin-inline-fields">
          <TextField label="Email" value={memberEmail} onChange={setMemberEmail} ariaLabel="New member email" placeholder="teammate@company.com" />
          <SelectField
            label="Role"
            ariaLabel="New member role"
            value={memberRole}
            onChange={setMemberRole}
            options={[{ value: "employee", label: "Employee" }, { value: "manager", label: "Manager" }, { value: "admin", label: "Administrator" }]}
          />
          <AdminButton
            variant="primary"
            icon={Users}
            disabled={!memberEmail.trim() || action.isPending}
            onClick={() => action.mutate({ type: "membership", email: memberEmail.trim(), role: memberRole }, { onSuccess: () => setMemberEmail("") })}
          >
            Add member
          </AdminButton>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Member</th><th>Person</th><th>Role</th><th>Active</th></tr></thead>
            <tbody>
              {memberships.map((member) => (
                <tr key={member.id} className="static">
                  <td>
                    <span className="min-w-0">
                      <b>{member.person?.display_name ?? member.person?.email ?? "Unmapped member"}</b>
                      <small>{member.person?.email ?? member.user_id}</small>
                    </span>
                  </td>
                  <td className="admin-quiet">{member.person_id ? "Mapped" : "No person mapping"}</td>
                  <td>
                    <SelectField
                      ariaLabel={`Role for ${member.person?.display_name ?? member.id}`}
                      value={member.role}
                      onChange={(next) => membership.mutate({ membership_id: member.id, role: next })}
                      options={[{ value: "employee", label: "Employee" }, { value: "manager", label: "Manager" }, { value: "admin", label: "Administrator" }]}
                    />
                  </td>
                  <td>
                    <label className="admin-toggle">
                      <input
                        type="checkbox"
                        checked={member.active}
                        disabled={membership.isPending}
                        onChange={(event) => membership.mutate({ membership_id: member.id, active: event.target.checked })}
                      />
                      <span aria-hidden />
                      <em>{member.active ? "Active" : "Inactive"}</em>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {membership.error ? <Notice tone="err">{(membership.error as Error).message}</Notice> : null}
        {action.error ? <Notice tone="err">{(action.error as Error).message}</Notice> : null}
      </AdminCard>

      <AdminCard icon={UsersRound} title="Teams" detail="Teams scope what managers can review and what the planning surfaces group">
        <div className="admin-inline-fields">
          <TextField label="New team" value={teamName} onChange={setTeamName} ariaLabel="New team name" placeholder="Team name" />
          <AdminButton
            variant="secondary"
            icon={UsersRound}
            disabled={!teamName.trim() || action.isPending}
            onClick={() => action.mutate({ type: "team", name: teamName.trim() }, { onSuccess: () => setTeamName("") })}
          >
            Create team
          </AdminButton>
        </div>
        {teams.length ? (
          <ul className="admin-rows spaced">
            {teams.map((team) => (
              <li key={String(team.id)}>
                <span>{String(team.name ?? "Team")}</span>
                <small>{teamMembers.filter((member) => String(member.team_id) === String(team.id)).length} member{teamMembers.filter((member) => String(member.team_id) === String(team.id)).length === 1 ? "" : "s"}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty-note">No teams yet. Create one, then add people below.</p>
        )}
        <div className="admin-inline-fields">
          <SelectField label="Team" ariaLabel="Team for the new member" value={teamId} onChange={setTeamId} placeholder="Select a team" options={teamOptions} />
          <SelectField label="Person" ariaLabel="Person to add to the team" value={teamPersonId} onChange={setTeamPersonId} placeholder="Select a person" options={personOptions} />
          <label className="admin-check">
            <input type="checkbox" checked={teamManager} onChange={(event) => setTeamManager(event.target.checked)} />
            Team manager
          </label>
          <AdminButton
            variant="secondary"
            disabled={!teamId || !teamPersonId || action.isPending}
            onClick={() => action.mutate({ type: "team_member", team_id: teamId, person_id: teamPersonId, is_manager: teamManager })}
          >
            Add to team
          </AdminButton>
        </div>
      </AdminCard>

      <div className="admin-band">
        <AdminCard icon={Cable} title="Provider connections" detail="Read-only here; tokens and webhooks are managed in the web console">
          {connections.isLoading ? (
            <Skeleton className="h-20" />
          ) : (connections.data?.connections ?? []).length ? (
            <ul className="admin-rows spaced">
              {(connections.data?.connections ?? []).map((connection) => (
                <li key={String(connection.id)}>
                  <span>{statusLabel(String(connection.provider ?? "provider"))}<small>{connection.external_workspace_id ? `workspace ${String(connection.external_workspace_id)}` : "no workspace id"}</small></span>
                  <Pill tone={connection.active === false ? "neutral" : "ok"}>{connection.active === false ? "Inactive" : "Active"}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty-note">No provider connections yet. Connect Nifty and GitHub in the web console.</p>
          )}
          <p className="admin-quiet">{(connections.data?.accounts ?? []).length} mapped provider account{(connections.data?.accounts ?? []).length === 1 ? "" : "s"}.</p>
        </AdminCard>

        <AdminCard icon={Cable} title="Field mappings" detail="How provider fields land in the task record">
          {mappings.isLoading ? (
            <Skeleton className="h-20" />
          ) : (mappings.data?.mappings ?? []).length ? (
            <ul className="admin-rows spaced">
              {(mappings.data?.mappings ?? []).slice(0, 10).map((mapping, index) => (
                <li key={String(mapping.id ?? index)}>
                  <span>{statusLabel(String(mapping.field ?? mapping.local_field ?? "Field"))}<small>provider field {String(mapping.provider_field_id ?? mapping.provider_field ?? "—")}</small></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty-note">No custom field mappings are configured.</p>
          )}
        </AdminCard>
      </div>

      <AdminCard icon={PlugZap} title="Blueprints" detail="Reusable task templates the workspace can generate from" padded={false}>
        {(blueprints.data?.blueprints ?? []).length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Blueprint</th><th>Kind</th><th>Updated</th></tr></thead>
              <tbody>
                {(blueprints.data?.blueprints ?? []).map((blueprint, index) => (
                  <tr key={String(blueprint.id ?? index)} className="static">
                    <td>{String(blueprint.name ?? blueprint.title ?? "Blueprint")}</td>
                    <td className="admin-quiet">{statusLabel(String(blueprint.kind ?? blueprint.source ?? "template"))}</td>
                    <td className="admin-quiet">{blueprint.updated_at ? relativeTime(String(blueprint.updated_at)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-card-body is-padded"><p className="admin-empty-note">No blueprints are configured yet.</p></div>
        )}
      </AdminCard>

      <p className="admin-disclaimer">
        Workspace settings apply to every member of the organization. Adding a member never changes their own employee record; roles decide which workspace they can open.
      </p>
    </div>
  );
}
