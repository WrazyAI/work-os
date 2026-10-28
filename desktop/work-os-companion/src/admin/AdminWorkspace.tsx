import type { ReactNode } from "react";
import { ArrowLeftRight, CircleHelp, RefreshCw } from "lucide-react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import SidebarNav from "../SidebarNav";
import { NotificationsBell } from "../NotificationsBell";
import { ProfileAvatar } from "../ProfileSettings";
import { FadeArc } from "../LoadingUi";
import { adminSectionQueryMatches } from "./adminRefresh";
import OverviewPage from "./OverviewPage";
import PeoplePage from "./PeoplePage";
import TasksPage from "./TasksPage";
import ReviewPage from "./ReviewPage";
import InsightsPage from "./InsightsPage";
import EvidencePage from "./EvidencePage";
import SettingsPage from "./SettingsPage";
import { AdminCard, Notice } from "./ui";
import type { GuideView } from "../guideState";
import type { AdminSection, AdminSectionFocus, SessionResponse } from "./types";
import "../insight-dashboard.css";
import "./admin.css";

export const ADMIN_SECTIONS: Record<AdminSection, { title: string; purpose: string }> = {
  overview: { title: "Overview", purpose: "What is happening across the workspace right now." },
  people: { title: "People", purpose: "Roster, schedules, and each teammate's recent record." },
  tasks: { title: "Tasks", purpose: "The workspace task record and what is still open." },
  review: { title: "EOD Review", purpose: "Submitted end-of-day reports and the decision they need." },
  insights: { title: "Insights", purpose: "Recorded outcomes and activity context across the selected range." },
  evidence: { title: "Evidence", purpose: "Observations and output evidence, with their provenance." },
  settings: { title: "Settings", purpose: "Your own settings, then the workspace's configuration, members, and provider connections." },
};

type Focus = AdminSectionFocus;

/** The masthead bell's data and row actions, owned by the shell exactly as the
 * employee masthead owns them (see `NotificationsBell`): the app wires the
 * queries and the cross-workspace handoffs, the workspace renders the panel. */
export type AdminNotifications = Parameters<typeof NotificationsBell>[0];

/** The signed-in admin's own profile, the same record and modal the employee
 * masthead's avatar opens. The shell owns the modal; the workspace renders the
 * control and calls `onOpen`. */
export type AdminProfileEntry = {
  name: string;
  avatarUrl?: string | null;
  onOpen: () => void;
};

/** The desktop administration workspace.
 *
 * One signed-in account, two workspaces: this shell reads the organization's
 * record and never changes the signed-in admin's own employee state. The
 * switch back to the personal workday is a view change, not a role change.
 * The masthead carries the same notifications bell the employee workspace
 * mounts — the account's own notifications — and the app supplies its data,
 * alongside the account's own profile avatar.
 *
 * The current section is a prop rather than local state: the app's page-guide
 * seam keys its first-visit flags by section, and the workspace tour drives
 * the section for real, so both need one source of truth for where the
 * workspace is. The guide itself is the same modal the employee workspace
 * uses; administration never owns a second copy of its state. */
export default function AdminWorkspace({ session, notifications, profile, onOpenWhatsNew, section, focus, onNavigate, onSwitchToEmployee, onNewChat, ottoNotice, onSignOut, guideView, onOpenGuide, personalSettings }: {
  session: SessionResponse;
  /** Absent (or a session with no mapped personal workday) renders no bell:
   * there is no employee record for it to report. */
  notifications?: AdminNotifications | null;
  /** Absent renders no avatar: the page-fixture preview mounts the workspace
   * without the account's profile record (see AdminPreview). */
  profile?: AdminProfileEntry | null;
  /** Administration-only changelog entry: the workspace menu wears one
   * "What's new" item when the shell supplies this. */
  onOpenWhatsNew?: (() => void) | undefined;
  section: AdminSection;
  focus: AdminSectionFocus;
  onNavigate: (section: AdminSection, focus?: AdminSectionFocus) => void;
  /** Absent when this administrator has no mapped personal workday. */
  onSwitchToEmployee?: (() => void) | undefined;
  /** The administration New chat entry. It starts the shared admin Otto
   * thread; it is never a dead sidebar control. */
  onNewChat?: (() => void) | undefined;
  /** A truthful blocked/loading line for the admin Otto context. */
  ottoNotice?: string | null;
  onSignOut: () => void;
  /** The page guide for the current section, and how to reopen it. */
  guideView?: GuideView | null;
  onOpenGuide?: (view: GuideView) => void;
  /** The signed-in account's own settings, rendered at the top of the
   * administration Settings page (see SettingsPage). */
  personalSettings?: ReactNode;
}) {
  const navigate = (next: AdminSection, nextFocus?: Focus) => onNavigate(next, nextFocus);
  const meta = ADMIN_SECTIONS[section];

  const queryClient = useQueryClient();
  /* The masthead refresh control mirrors the employee one (App.tsx): it
   * revalidates only the reads backing the current section — never a blanket
   * app refresh. The same control spins whenever that section's data is
   * fetching, because `useIsFetching` observes the live query cache: the
   * Overview 60s poll, invalidations after a write, focus revalidation, or
   * this button's own click all drive the same state. Settings keeps no
   * page refresh (design.md §16.1). */
  const fetching = useIsFetching({ predicate: (query) => adminSectionQueryMatches(section, query.queryKey) });

  const content = section === "overview"
    ? <OverviewPage onOpenSection={(next, focus) => navigate(next, focus)} onOpenPerson={(personId) => navigate("people", { personId })} />
    : section === "people"
      ? <PeoplePage key={focus.personId ?? "people"} initialPersonId={focus.personId} onOpenReport={(reportId) => navigate("review", { reportId })} />
      : section === "tasks"
        ? <TasksPage key={focus.taskId ?? "tasks"} initialTaskId={focus.taskId} />
        : section === "review"
          ? <ReviewPage key={focus.reportId ?? "review"} initialReportId={focus.reportId} />
          : section === "insights"
            ? <InsightsPage key={focus.personId ?? "insights"} initialPersonId={focus.personId} />
            : section === "evidence"
              ? <EvidencePage key={focus.evidenceTab ?? "evidence"} initialTab={focus.evidenceTab} />
              : <SettingsPage personalSettings={personalSettings} />;

  return (
    <div className="workspace admin-workspace">
      <SidebarNav
        mode="admin"
        activeView="day"
        onNavigate={() => undefined}
        adminSection={section}
        onAdminNavigate={(next) => navigate(next)}
        onNewChat={() => onNewChat?.()}
        onSwitchWorkspace={onSwitchToEmployee}
        switchLabel="Switch to employee view"
        onWhatsNew={onOpenWhatsNew}
        onSignOut={onSignOut}
      />
      <section className="stage admin-stage">
        <header className="masthead admin-masthead">
          <div className="admin-masthead-copy">
            <p>Work OS · Administration</p>
            <div className="masthead-title-row"><h1>{meta.title}</h1></div>
          </div>
          <div className="mast-actions">
            {session.role === "admin" && guideView && onOpenGuide ? (
              <button
                type="button"
                className="icon guide-launch"
                title={`How ${meta.title} works`}
                aria-label={`How ${meta.title} works`}
                onClick={() => onOpenGuide(guideView)}
              >
                <CircleHelp size={17} />
              </button>
            ) : null}
            {session.personId ? (
              onSwitchToEmployee ? (
                <button type="button" className="admin-switch" onClick={onSwitchToEmployee} title="Open your own workday">
                  <ArrowLeftRight size={14} aria-hidden /> Switch to employee view
                </button>
              ) : null
            ) : (
              <span className="admin-quiet">No personal workday is mapped to this account</span>
            )}
            {session.personId && notifications ? <NotificationsBell {...notifications} /> : null}
            {session.role === "admin" && section !== "settings" ? (
              <button
                type="button"
                className="icon"
                title="Refresh this page"
                aria-label="Refresh this page"
                disabled={fetching > 0}
                onClick={() => void queryClient.refetchQueries({ predicate: (query) => adminSectionQueryMatches(section, query.queryKey), type: "active" })}
              >
                {fetching > 0 ? <FadeArc size={17} /> : <RefreshCw size={17} />}
              </button>
            ) : null}
            {profile ? (
              <button type="button" className="avatar" aria-label={`Profile for ${profile.name}`} title="Open profile settings" onClick={profile.onOpen}>
                <ProfileAvatar name={profile.name} avatarUrl={profile.avatarUrl} />
              </button>
            ) : null}
          </div>
          {/* One calm header: the page's purpose sits inside the masthead
              block, directly under its title, instead of under the rule. */}
          {session.role === "admin" ? <p className="admin-purpose">{meta.purpose}</p> : null}
        </header>
        <main className="page admin-page">
          {ottoNotice ? <Notice tone="warn">{ottoNotice}</Notice> : null}
          {session.role === "admin" ? (
            content
          ) : (
            <AdminCard title="Administration requires an admin membership">
              <Notice tone="warn">This account is not an administrator of the workspace. Switch back to the employee view to continue.</Notice>
            </AdminCard>
          )}
        </main>
      </section>
    </div>
  );
}
