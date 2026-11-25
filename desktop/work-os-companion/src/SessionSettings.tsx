import { LogOut } from "lucide-react";
import { AgentAccessSummary } from "./AgentAccessSettings";
import { Setting } from "./Setting";

/** The Session page's default view. It owns the sync rows and the one summary
 * band that enters the inline agent-access view; the settings stage swaps this
 * whole body for the management view rather than stacking a modal over it. */
export function SessionSettings({ queueCount, queueAttentionCount, sessionApiBase, busy, onSignOut, agentAccessSurface, adminAgentApiEnabled, onManageAgentAccess }: {
  queueCount: number;
  queueAttentionCount: number;
  sessionApiBase: string;
  busy: boolean;
  onSignOut: () => void;
  agentAccessSurface: "employee" | "admin";
  adminAgentApiEnabled?: boolean;
  onManageAgentAccess: () => void;
}) {
  return (
    <>
      <section className="settings-group" aria-labelledby="settings-sync-title">
        <header className="settings-group-head"><h3 id="settings-sync-title">Sync &amp; session</h3></header>
        <section className="settings-panel">
          <Setting
            title="Offline queue"
            detail={queueAttentionCount
              ? `${queueAttentionCount} update${queueAttentionCount === 1 ? "" : "s"} need attention`
              : queueCount
                ? `${queueCount} updates waiting to sync`
                : "Everything is synced"}
          >
            <span className={`status-chip${queueAttentionCount ? " attention" : ""}`}>{queueAttentionCount ? "Needs attention" : "Ready"}</span>
          </Setting>
          <Setting title="Account session" detail={`Signed in through ${sessionApiBase}`}>
            <button type="button" className="quiet-action danger" disabled={busy} onClick={onSignOut}><LogOut size={15} /> Sign out</button>
          </Setting>
        </section>
      </section>
      <AgentAccessSummary
        surface={agentAccessSurface}
        apiBase={sessionApiBase}
        adminEnabled={adminAgentApiEnabled !== false}
        onManage={onManageAgentAccess}
      />
    </>
  );
}
