import { Bell, Cable, PlugZap, ShieldCheck, SlidersHorizontal, Users, UsersRound } from "lucide-react";
import SettingsPage, { type AdminSettingsCardId } from "./admin/SettingsPage";
import { SettingsContent } from "./SettingsContent";
import { SETTINGS_PAGES, type SettingsNavPage, type SettingsPageId } from "./settingsSections";
import type { PersonalSettingsProps } from "./PersonalSettings";

export type AdminSettingsPageId = SettingsPageId | "workspace-status" | "features" | "members" | "teams" | "connections" | "mappings" | "blueprints" | "recap-follows";

const ADMIN_PAGES: SettingsNavPage<AdminSettingsPageId>[] = [
  { id: "workspace-status", label: "Workspace status", group: "Workspace", icon: ShieldCheck, description: "Schema readiness and the workspace database.", keywords: ["status", "schema", "database", "workspace"] },
  { id: "features", label: "Features", group: "Workspace", icon: SlidersHorizontal, description: "One switch per workspace capability; changes apply to every member.", keywords: ["features", "capabilities", "switches"] },
  { id: "members", label: "Members", group: "Workspace", icon: Users, description: "Who belongs to the workspace and the role each person can open.", keywords: ["members", "roles", "access", "people"] },
  { id: "teams", label: "Teams", group: "Workspace", icon: UsersRound, description: "Teams scope what managers can review and what planning groups.", keywords: ["teams", "managers", "groups"] },
  { id: "connections", label: "Connections", group: "Integrations", icon: Cable, description: "Provider connections and mapped evidence accounts.", keywords: ["connections", "providers", "github", "worktivity", "nifty"] },
  { id: "mappings", label: "Field mappings", group: "Integrations", icon: Cable, description: "How provider fields land in the task record.", keywords: ["mappings", "fields", "providers"] },
  { id: "blueprints", label: "Blueprints", group: "Integrations", icon: PlugZap, description: "Reusable task templates the workspace can generate from.", keywords: ["blueprints", "templates", "tasks"] },
];

const ADMIN_CARD_BY_PAGE: Partial<Record<AdminSettingsPageId, AdminSettingsCardId>> = {
  "workspace-status": "status",
  features: "features",
  members: "members",
  teams: "teams",
  connections: "connections",
  mappings: "mappings",
  blueprints: "blueprints",
};

export const ADMIN_RECAP_PAGE: SettingsNavPage<AdminSettingsPageId> = {
  id: "recap-follows",
  label: "Recap follows",
  group: "Account",
  icon: Bell,
  description: "Choose which reviewed recaps alert you in the administration inbox.",
  keywords: ["recap", "alerts", "follows", "notifications", "inbox"],
};

export function adminSettingsPages(hasPersonalRecord: boolean, hasRecapSettings = false): SettingsNavPage<AdminSettingsPageId>[] {
  const personal = SETTINGS_PAGES.filter((page) => !page.requiresPersonalRecord || hasPersonalRecord);
  const about = personal.find((page) => page.id === "about");
  const data = personal.filter((page) => page.group === "Data & privacy");
  const beforeData = personal.filter((page) => page.id !== "about" && page.group !== "Data & privacy");
  const sessionIndex = beforeData.findIndex((page) => page.id === "session");
  const withRecap = hasRecapSettings
    ? [...beforeData.slice(0, sessionIndex + 1), ADMIN_RECAP_PAGE, ...beforeData.slice(sessionIndex + 1)]
    : beforeData;
  return [...withRecap, ...ADMIN_PAGES, ...data, ...(about ? [about] : [])];
}

/** The stage half of the administration settings takeover. Personal pages
 * render through the same SettingsContent as the employee workspace; each
 * workspace card is its own page. */
export function AdminSettingsContent({ active, visiblePages, query, onSelect, onQuery, personalSettingsProps }: {
  active: AdminSettingsPageId;
  visiblePages: SettingsNavPage<AdminSettingsPageId>[];
  query: string;
  onSelect: (page: AdminSettingsPageId) => void;
  onQuery: (value: string) => void;
  personalSettingsProps: PersonalSettingsProps;
}) {
  const recapPage = visiblePages.find((page) => page.id === "recap-follows");
  const adminPage = visiblePages.find((page) => page.id === active && ADMIN_CARD_BY_PAGE[page.id]);
  const normalized = query.trim();

  if (active === "recap-follows" && recapPage && personalSettingsProps.adminOttoSettings) {
    return <section className="settings-content-page admin-settings-content" aria-labelledby="settings-page-title">
      <header className="settings-content-head">
        <p className="settings-content-eyebrow">Account</p>
        <h2 id="settings-page-title">{recapPage.label}</h2>
        <p>{recapPage.description}</p>
      </header>
      <div className="settings-content-body" data-hide-first-head="true">
        {personalSettingsProps.adminOttoSettings}
      </div>
    </section>;
  }

  if (adminPage) {
    return <section className="settings-content-page admin-settings-content" aria-labelledby="settings-page-title">
      <header className="settings-content-head">
        <p className="settings-content-eyebrow">{adminPage.group}</p>
        <h2 id="settings-page-title">{adminPage.label}</h2>
        <p>{adminPage.description}</p>
      </header>
      <div className="settings-content-body admin-settings-body">
        <SettingsPage personalSettings={undefined} activeCard={ADMIN_CARD_BY_PAGE[adminPage.id]} />
      </div>
    </section>;
  }

  const personalVisible = visiblePages.filter((page) => !ADMIN_CARD_BY_PAGE[page.id] && page.id !== "recap-follows");
  const personalPage = SETTINGS_PAGES.find((page) => page.id === active);
  if (personalPage && personalVisible.some((page) => page.id === active)) {
    return <SettingsContent
      {...personalSettingsProps}
      active={active as SettingsPageId}
      visiblePages={SETTINGS_PAGES.filter((page) => personalVisible.some((entry) => entry.id === page.id))}
      query={query}
      onSelect={(page) => onSelect(page)}
      onQuery={onQuery}
    />;
  }

  if (normalized && visiblePages.length) {
    return <section className="settings-content-page admin-settings-content" aria-labelledby="settings-page-title">
      <header className="settings-content-head">
        <p className="settings-content-eyebrow">Search</p>
        <h2 id="settings-page-title">Results for “{normalized}”</h2>
        <p>Choose the settings page that holds what you need.</p>
      </header>
      <div className="settings-search-results">
        {visiblePages.map((page) => <button key={page.id} type="button" className="settings-result" onClick={() => onSelect(page.id)}>
          <span className="settings-result-icon" aria-hidden="true"><page.icon size={17} strokeWidth={1.8} /></span>
          <span className="settings-result-copy"><strong>{page.label}</strong><small>{page.description}</small></span>
          <span className="settings-result-group">{page.group}</span>
        </button>)}
      </div>
    </section>;
  }

  return <section className="settings-content-page admin-settings-content" aria-labelledby="settings-page-title">
    <div className="settings-empty">
      <h2 id="settings-page-title">No settings match</h2>
      <p>Try a different word, or clear the search to see every page.</p>
      <button type="button" className="quiet-action" onClick={() => onQuery("")}>Clear search</button>
    </div>
  </section>;
}

