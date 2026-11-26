import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, Gauge, KeyRound, PlugZap, ShieldCheck, Users, UsersRound } from "lucide-react";
import { useNotifications } from "../NotificationFlyouts";
import { ADMIN_STATUS_DEGRADED_KEY, adminRoleLabel, workspaceDegradedNotice } from "./adminNotifications";
import {
  adminKeys,
  ADMIN_STALE_MS,
  fetchBlueprints,
  fetchConnections,
  fetchOrganization,
  fetchPeople,
  fetchSystemStatus,
  normalizeBlueprints,
  normalizeConnections,
  normalizeOrganization,
  normalizePeople,
  normalizeSystemStatus,
  organizationAction,
  organizationMembershipPatch,
  relativeTime,
  saveOrganizationFeatures,
  sendOrganizationMemberPasswordReset,
  statusLabel,
  updateAdminPerson,
} from "./data";
import type { OrganizationMembershipRow } from "./types";
import { AdminButton, AdminCard, AdminRowsSkeleton, Notice, Pill, SelectField, TextField } from "./ui";

const FEATURES: Array<{ key: string; label: string; detail: string }> = [
  { key: "employee_companion", label: "Employee workspace", detail: "Plans, updates, EOD reports, and the employee companion login." },
  { key: "desktop_companion", label: "Desktop companion", detail: "The installed app, device sessions, and update delivery." },
  { key: "screenshot_summaries", label: "Screenshot summaries", detail: "Worktivity frame summaries and retained frames behind the flagged/disputed rule." },
  { key: "github_evidence", label: "GitHub evidence", detail: "Commits, pull requests, reviews, and workflow runs become output evidence." },
  { key: "ghl_evidence", label: "GoHighLevel evidence", detail: "Opportunity and appointment activity becomes output evidence." },
  { key: "seo_mission_control", label: "SEO mission control", detail: "The SEO operations surfaces inside the console." },
  { key: "voice_input", label: "Voice input & output", detail: "Record → transcribe → review in the composers, and hear recaps read back." },
];

/** Workspace settings: what the organization has switched on, who belongs to
 * it, and the provider connections that feed the record. Credentials and
 * mapping writes stay in the web console; the desktop reads their state.
 *
 * The page leads with the account's own settings when the shell supplies them
 * — the same groups the employee Settings page carries, one shared component —
 * so an administrator never has to switch workspaces to change their own
 * device, appearance, or guide preferences. The shell's node also carries the
 * account's recap-follow group, which stays present without a personal
 * workday record; this page only hosts it above the workspace configuration. */
export type AdminSettingsCardId = "status" | "features" | "insights" | "members" | "teams" | "connections" | "blueprints";

/** Pick only the failures owned by the card on screen. The all-cards fallback
 * is the legacy single-page render; the category workspace always names one. */
export function selectSettingsCardError(
  activeCard: AdminSettingsCardId | undefined,
  errors: Record<AdminSettingsCardId, unknown[]>,
): unknown {
  // A restored or stale navigation value must never index a missing card.
  const owned = activeCard ? errors[activeCard] : undefined;
  return Array.isArray(owned) ? owned.find(Boolean) : Object.values(errors).flat().find(Boolean);
}

/** Mutation failures stay separate: a failed Add member must not hide behind
 * an earlier role-change failure that has not been cleared. */
export function SettingsErrorNotices({ errors }: { errors: unknown[] }) {
  return <>{errors.filter(Boolean).map((error, index) => (
    <Notice key={index} tone="err">{(error as Error).message}</Notice>
  ))}</>;
}

function formatResetSentTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function SettingsPage({ personalSettings, activeCard }: { personalSettings?: ReactNode; activeCard?: AdminSettingsCardId }) {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const confirmTitleId = useId();
  const confirmDialogRef = useRef<HTMLDialogElement | null>(null);
  const confirmPressedOutside = useRef(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState("employee");
  const [confirmResetMember, setConfirmResetMember] = useState<OrganizationMembershipRow | null>(null);
  const [sentResets, setSentResets] = useState<Record<string, { sentAt: string; email: string }>>({});
  const [teamName, setTeamName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teamPersonId, setTeamPersonId] = useState("");
  const [teamManager, setTeamManager] = useState(false);

  const organization = useQuery({ queryKey: adminKeys.organization(), queryFn: fetchOrganization, select: normalizeOrganization, staleTime: ADMIN_STALE_MS });
  const status = useQuery({ queryKey: adminKeys.status(), queryFn: fetchSystemStatus, select: normalizeSystemStatus, staleTime: ADMIN_STALE_MS });
  const connections = useQuery({ queryKey: adminKeys.connections(), queryFn: fetchConnections, select: normalizeConnections, staleTime: ADMIN_STALE_MS });
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
  const exclusion = useMutation({
    mutationFn: ({ id, excluded }: { id: string; name: string; excluded: boolean }) => updateAdminPerson({ id, excluded_from_insights: excluded }),
    onSuccess: (_result, variables) => {
      invalidate();
      notifications.success(
        `${variables.name} is ${variables.excluded ? "hidden from" : "included in"} Insights.`,
        variables.excluded ? "Insights exclusion saved" : "Insights exclusion cleared",
      );
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
  const passwordReset = useMutation({
    mutationFn: (member: OrganizationMembershipRow) => sendOrganizationMemberPasswordReset(member.id),
    onSuccess: (result) => {
      setSentResets((previous) => ({
        ...previous,
        [result.membershipId]: { sentAt: result.sentAt, email: result.email },
      }));
      notifications.success(`Sent a 1-hour password reset link to ${result.email}.`, "Password reset sent");
    },
  });

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!confirmResetMember || !dialog) return;
    if (!dialog.open) dialog.showModal();
  }, [confirmResetMember]);
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

  // Each settings page owns the reads and mutations its card shows. A failure
  // in one optional card must never headline a page that does not read it.
  const actionCard: AdminSettingsCardId | null =
    action.variables?.type === "membership" ? "members" : action.variables ? "teams" : null;
  const cardErrors: Record<AdminSettingsCardId, unknown[]> = {
    status: [organization.error, status.error],
    features: [organization.error, features.error],
    insights: [people.error, exclusion.error],
    members: [organization.error],
    teams: [organization.error, people.error],
    connections: [connections.error],
    blueprints: [blueprints.error],
  };
  const error = selectSettingsCardError(activeCard, cardErrors);
  const flags = (organization.data?.organization?.feature_flags ?? {}) as Record<string, boolean>;
  const memberships = organization.data?.memberships ?? [];
  const teams = organization.data?.teams ?? [];
  const teamMembers = organization.data?.teamMembers ?? [];
  const personOptions = (people.data?.people ?? []).map((person) => ({ value: String(person.id), label: String(person.display_name ?? "Unnamed") }));
  const teamOptions = teams.map((team) => ({ value: String(team.id), label: String(team.name ?? "Team") }));

  return (
    <div className="admin-grid" data-active-card={activeCard ?? "all"}>
      <h2 className="sr-only">Workspace settings</h2>
      {personalSettings ? <div className="admin-personal-settings">{personalSettings}</div> : null}
      {error ? <Notice tone="err">{(error as Error).message}</Notice> : null}

      <AdminCard
        className="admin-card-status"
        icon={ShieldCheck}
        title="Workspace status"
        detail="Schema readiness and the workspace database"
      >
        {status.isLoading || organization.isLoading ? (
          <AdminRowsSkeleton label="Loading workspace status" rows={1} />
        ) : (
          <div className="admin-chips">
            <Pill tone={status.data?.schema?.ready ? "ok" : "warn"}>{status.data?.schema?.ready ? "Work OS schema ready" : "Migration required"}</Pill>
            <Pill>{organization.data?.organization?.name ?? "Workspace"}</Pill>
            <Pill>slug {organization.data?.organization?.slug || "—"}</Pill>
          </div>
        )}
      </AdminCard>

      <AdminCard className="admin-card-features" icon={PlugZap} title="Features" detail="One switch per workspace capability; changes apply to every member">
        {organization.isLoading ? <AdminRowsSkeleton label="Loading workspace features" /> : <ul className="admin-feature-list">
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
        </ul>}
      </AdminCard>

      <AdminCard className="admin-card-insights" icon={Gauge} title="Insights exclusions" detail="People left out of Insights and its totals; they stay in the roster and can still sign in">
        <p className="admin-quiet">Use this for test accounts, shared inboxes, or owners who should not be counted in team analytics. Excluded people are omitted from the Insights person list, its matrix, and its totals.</p>
        {people.isLoading ? (
          <AdminRowsSkeleton label="Loading Insights exclusions" rows={3} leading />
        ) : people.data?.people?.length ? (
          <ul className="admin-feature-list admin-exclusion-list">
            {people.data.people.map((person) => {
              const id = String(person.id);
              const name = String(person.display_name ?? person.email ?? "Unnamed person");
              const excluded = person.excluded_from_insights === true;
              return (
                <li key={id}>
                  <span>
                    <b>{name}</b>
                    <small>{person.email ? String(person.email) : "No email"}</small>
                  </span>
                  <label className="admin-toggle">
                    <input
                      type="checkbox"
                      checked={excluded}
                      disabled={exclusion.isPending}
                      onChange={(event) => exclusion.mutate({ id, name, excluded: event.target.checked })}
                      aria-label={`Exclude ${name} from Insights`}
                    />
                    <span aria-hidden />
                    <em>{excluded ? "Excluded" : "Included"}</em>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="admin-empty-note">No active people to manage.</p>
        )}
        <SettingsErrorNotices errors={[exclusion.error]} />
      </AdminCard>

      <AdminCard className="admin-card-members" icon={Users} title="Members" detail={`${memberships.length} member${memberships.length === 1 ? "" : "s"} · roles decide which workspace each person can open`}>
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
        {organization.isLoading ? <AdminRowsSkeleton label="Loading workspace members" leading /> : <div className="admin-table-wrap" tabIndex={0} role="region" aria-label="Workspace members">
          <table className="admin-table">
            <thead><tr><th>Member</th><th>Person</th><th>Role</th><th>Active</th><th className="admin-col-end">Password</th></tr></thead>
            <tbody>
              {memberships.map((member) => {
                const displayName = member.person?.display_name ?? member.email ?? member.person?.email ?? "Unmapped member";
                const loginEmail = member.email ?? member.person?.email ?? null;
                const sentRecord = sentResets[member.id];
                const isSendingThis = passwordReset.isPending && passwordReset.variables?.id === member.id;
                return (
                  <tr key={member.id} className="static">
                    <td data-label="Member">
                      <span className="admin-member-identity">
                        <b>{displayName}</b>
                        <small>{loginEmail ?? member.user_id}</small>
                      </span>
                    </td>
                    <td data-label="Person" className="admin-quiet">{member.person_id ? "Mapped" : "No person mapping"}</td>
                    <td data-label="Role">
                      <SelectField
                        ariaLabel={`Role for ${displayName}`}
                        value={member.role}
                        onChange={(next) => membership.mutate({ membership_id: member.id, role: next })}
                        options={[{ value: "employee", label: "Employee" }, { value: "manager", label: "Manager" }, { value: "admin", label: "Administrator" }]}
                      />
                    </td>
                    <td data-label="Active">
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
                    <td data-label="Password" className="admin-member-reset-cell">
                      {!member.active ? (
                        <AdminButton
                          variant="secondary"
                          disabled
                          title="Activate this member before sending a password reset email"
                          ariaLabel={`Password reset unavailable for inactive member ${displayName}`}
                        >
                          Inactive
                        </AdminButton>
                      ) : isSendingThis ? (
                        <AdminButton variant="secondary" disabled icon={KeyRound}>
                          Sending…
                        </AdminButton>
                      ) : sentRecord ? (
                        <span className="admin-member-reset-sent">
                          <span className="admin-member-reset-receipt">Sent {formatResetSentTime(sentRecord.sentAt)}</span>
                          <button
                            type="button"
                            className="admin-member-reset-resend"
                            disabled={passwordReset.isPending}
                            onClick={() => {
                              passwordReset.reset();
                              setConfirmResetMember(member);
                            }}
                          >
                            Resend
                          </button>
                        </span>
                      ) : (
                        <AdminButton
                          variant="secondary"
                          icon={KeyRound}
                          disabled={passwordReset.isPending}
                          ariaLabel={`Send password reset email to ${displayName}`}
                          onClick={() => {
                            passwordReset.reset();
                            setConfirmResetMember(member);
                          }}
                        >
                          Send reset
                        </AdminButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>}
        <SettingsErrorNotices errors={[membership.error, passwordReset.error, actionCard === "members" ? action.error : null]} />
      </AdminCard>
      {confirmResetMember ? (
        <dialog
          ref={confirmDialogRef}
          className="admin-confirm-dialog"
          aria-labelledby={confirmTitleId}
          {...({ closedby: "any" } as Record<string, string>)}
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
          <div className="admin-confirm-dialog-body">
            <h1 id={confirmTitleId}>Send password reset email?</h1>
            <p className="admin-confirm-dialog-copy">
              This sends a one-time link to choose a new WrazyOS password. Their current password stays unchanged until they complete the reset.
            </p>
            <dl className="admin-confirm-dialog-meta">
              <div>
                <dt>Member</dt>
                <dd>{confirmResetMember.person?.display_name ?? confirmResetMember.email ?? confirmResetMember.person?.email ?? "Workspace member"}</dd>
              </div>
              <div>
                <dt>Sign-in email</dt>
                <dd className="is-mono">{confirmResetMember.email ?? confirmResetMember.person?.email ?? "Resolved from account"}</dd>
              </div>
              <div>
                <dt>Link expiry</dt>
                <dd>1 hour</dd>
              </div>
            </dl>
            <form method="dialog" className="admin-confirm-dialog-actions">
              <button type="submit" value="cancel" className="admin-button secondary" autoFocus>
                Cancel
              </button>
              <button type="submit" value="confirm" className="admin-button primary">
                Send reset email
              </button>
            </form>
          </div>
        </dialog>
      ) : null}

      <AdminCard className="admin-card-teams" icon={UsersRound} title="Teams" detail="Teams scope what managers can review and what the planning surfaces group">
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
        {organization.isLoading ? <AdminRowsSkeleton label="Loading workspace teams" rows={2} /> : teams.length ? (
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
        <SettingsErrorNotices errors={[actionCard === "teams" ? action.error : null]} />
      </AdminCard>

      <AdminCard className="admin-card-connections" icon={Cable} title="Provider connections" detail="Read-only here; tokens and webhooks are managed in the web console">
        {connections.isLoading ? (
          <AdminRowsSkeleton label="Loading provider connections" rows={2} />
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
          <p className="admin-empty-note">No provider connections yet. Connect your evidence providers in the web console.</p>
        )}
        <p className="admin-quiet">{(connections.data?.accounts ?? []).length} mapped provider account{(connections.data?.accounts ?? []).length === 1 ? "" : "s"}.</p>
      </AdminCard>

      <AdminCard className="admin-card-blueprints" icon={PlugZap} title="Blueprints" detail="Reusable task templates the workspace can generate from" padded={false}>
        {blueprints.isLoading ? <AdminRowsSkeleton label="Loading blueprints" rows={3} /> : (blueprints.data?.blueprints ?? []).length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Blueprint</th><th>Kind</th><th>Updated</th></tr></thead>
              <tbody>
                {(blueprints.data?.blueprints ?? []).map((blueprint, index) => (
                  <tr key={String(blueprint.id ?? index)} className="static">
                    <td data-label="Blueprint">{String(blueprint.name ?? blueprint.title ?? "Blueprint")}</td>
                    <td data-label="Kind" className="admin-quiet">{statusLabel(String(blueprint.kind ?? blueprint.source ?? "template"))}</td>
                    <td data-label="Updated" className="admin-quiet">{blueprint.updated_at ? relativeTime(String(blueprint.updated_at)) : "—"}</td>
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
