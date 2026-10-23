import type { WorkOsViewMode } from "./view-mode";
import type { WorkOsWorkspaceChoice, WorkOsWorkspaceRole } from "./workspace";

/**
 * The /api/work-os/session contract.
 *
 * A caller with more than one active membership and no chosen workspace gets
 * the explicit selection shape; the server never picks one for them. Once a
 * workspace is chosen, the ready shape names it and carries every membership so
 * the shell can offer a switch without another read.
 */
export type WorkOsSessionInfo =
  | {
      requiresWorkspaceSelection: true;
      organizations: WorkOsWorkspaceChoice[];
    }
  | {
      requiresWorkspaceSelection: false;
      organizationId: string;
      organizationName: string;
      role: WorkOsWorkspaceRole;
      personId: string | null;
      userId: string;
      featureFlags: Record<string, boolean>;
      viewMode: WorkOsViewMode;
      organizations: WorkOsWorkspaceChoice[];
    };
