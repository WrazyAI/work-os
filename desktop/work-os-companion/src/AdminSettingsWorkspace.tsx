import { Bell, ShieldCheck } from "lucide-react";
import SettingsPage from "./admin/SettingsPage";
import { SettingsContent } from "./SettingsContent";
import { SETTINGS_PAGES, type SettingsNavPage, type SettingsPageId } from "./settingsSections";
import type { PersonalSettingsProps } from "./PersonalSettings";

export type AdminSettingsPageId = SettingsPageId | "workspace-settings" | "recap-follows";

/** The one workspace-configuration page in the administration settings rail.
 * The admin cards keep their existing component and order; the sidebar gives
 * them a stable destination while the personal settings pages stay shared. */
export const ADMIN_WORKSPACE_PAGE: SettingsNavPage<AdminSettingsPageId> = {
  id: "workspace-settings",
  label: "Workspace settings",
  group: "Workspace",
  icon: ShieldCheck,
  description: "Workspace status, features, members, teams, provider connections, mappings, and blueprints.",
  keywords: ["workspace", "status", "features", "members", "teams", "connections", "mappings", "blueprints", "providers"],
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
  return [...withRecap, ADMIN_WORKSPACE_PAGE, ...data, ...(about ? [about] : [])];
}

/** The stage half of the administration settings takeover. Personal pages
 * render through the same SettingsContent as the employee workspace; the
 * workspace page keeps the existing admin cards. */
export function AdminSettingsContent({ active, visiblePages, query, onSelect, onQuery, personalSettingsProps }: {
  active: AdminSettingsPageId;
  visiblePages: SettingsNavPage<AdminSettingsPageId>[];
  query: string;
  onSelect: (page: AdminSettingsPageId) => void;
  onQuery: (value: string) => void;
  personalSettingsProps: PersonalSettingsProps;
}) {
  const workspacePage = visiblePages.find((page) => page.id === "workspace-settings");
  const recapPage = visiblePages.find((page) => page.id === "recap-follows");
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

  if (active === "workspace-settings" && workspacePage) {
    return <section className="settings-content-page admin-settings-content" aria-labelledby="settings-page-title">
      <header className="settings-content-head">
        <p className="settings-content-eyebrow">Workspace</p>
        <h2 id="settings-page-title">{workspacePage.label}</h2>
        <p>{workspacePage.description}</p>
      </header>
      <div className="settings-content-body admin-settings-body">
        <SettingsPage personalSettings={undefined} />
      </div>
    </section>;
  }

  const personalVisible = visiblePages.filter((page) => page.id !== "workspace-settings");
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

