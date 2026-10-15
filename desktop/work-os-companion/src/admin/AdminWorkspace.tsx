import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import SidebarNav from "../SidebarNav";
import { NotificationsBell } from "../NotificationsBell";
import OverviewPage from "./OverviewPage";
import PeoplePage from "./PeoplePage";
import TasksPage from "./TasksPage";
import ReviewPage from "./ReviewPage";
import InsightsPage from "./InsightsPage";
import EvidencePage from "./EvidencePage";
import SettingsPage from "./SettingsPage";
import { AdminCard, Notice } from "./ui";
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
  settings: { title: "Settings", purpose: "Workspace configuration, members, and provider connections." },
};

type Focus = AdminSectionFocus;

/** The masthead bell's data and row actions, owned by the shell exactly as the
 * employee masthead owns them (see `NotificationsBell`): the app wires the
 * queries and the cross-workspace handoffs, the workspace renders the panel. */
export type AdminNotifications = Parameters<typeof NotificationsBell>[0];

/** The desktop administration workspace.
 *
 * One signed-in account, two workspaces: this shell reads the organization's
 * record and never changes the signed-in admin's own employee state. The
 * switch back to the personal workday is a view change, not a role change.
 * The masthead carries the same notifications bell the employee workspace
 * mounts — the account's own notifications — and the app supplies its data. */
export default function AdminWorkspace({ session, notifications, onSwitchToEmployee, onSignOut, initialSection = "overview", initialFocus }: {
  session: SessionResponse;
  /** Absent (or a session with no mapped personal workday) renders no bell:
   * there is no employee record for it to report. */
  notifications?: AdminNotifications | null;
  onSwitchToEmployee: () => void;
  onSignOut: () => void;
  initialSection?: AdminSection;
  initialFocus?: AdminSectionFocus;
}) {
  const [section, setSection] = useState<AdminSection>(initialSection);
  const [focus, setFocus] = useState<Focus>(initialFocus ?? {});
  const navigate = (next: AdminSection, nextFocus?: Focus) => {
    setSection(next);
    setFocus(nextFocus ?? {});
  };
  const meta = ADMIN_SECTIONS[section];

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
              : <SettingsPage />;

  return (
    <div className="workspace admin-workspace">
      <SidebarNav
        mode="admin"
        activeView="day"
        onNavigate={() => undefined}
        adminSection={section}
        onAdminNavigate={(next) => navigate(next)}
        onNewChat={() => undefined}
        onSwitchWorkspace={onSwitchToEmployee}
        switchLabel="Switch to employee view"
        onSignOut={onSignOut}
      />
      <section className="stage admin-stage">
        <header className="masthead admin-masthead">
          <div className="admin-masthead-copy">
            <p>Work OS · Administration</p>
            <div className="masthead-title-row"><h1>{meta.title}</h1></div>
          </div>
          <div className="mast-actions">
            {session.personId ? (
              <button type="button" className="admin-switch" onClick={onSwitchToEmployee} title="Open your own workday">
                <ArrowLeftRight size={14} aria-hidden /> Switch to employee view
              </button>
            ) : (
              <span className="admin-quiet">No personal workday is mapped to this account</span>
            )}
            {session.personId && notifications ? <NotificationsBell {...notifications} /> : null}
          </div>
          {/* One calm header: the page's purpose sits inside the masthead
              block, directly under its title, instead of under the rule. */}
          {session.role === "admin" ? <p className="admin-purpose">{meta.purpose}</p> : null}
        </header>
        <main className="page admin-page">
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
