import { useRef, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowUpRight, Search, X } from "lucide-react";
import { ProfileAvatar } from "./ProfileSettings";
import type { SettingsNavPage } from "./settingsSections";

type SettingsSidebarProps<T extends string> = {
  active: T;
  visiblePages: SettingsNavPage<T>[];
  query: string;
  onQuery: (value: string) => void;
  onSelect: (page: T) => void;
  onBack: () => void;
  hasPersonalRecord: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
};

/** The Work OS sidebar becomes this rail while Settings is on screen. The
 * content page is a sibling in the stage; this rail owns only navigation,
 * search, and the way back to the app. */
export function SettingsSidebar<T extends string>({ active, visiblePages, query, onQuery, onSelect, onBack, hasPersonalRecord, displayName, avatarUrl }: SettingsSidebarProps<T>) {
  const navRef = useRef<HTMLElement | null>(null);
  const aboutPage = visiblePages.find((page) => page.id === "about") ?? null;
  const navPages = visiblePages.filter((page) => page.id !== "about" && page.id !== "profile");
  const groups = Array.from(new Set(navPages.map((page) => page.group))).filter(Boolean);
  const tabStop = visiblePages.some((page) => page.id === active) ? active : visiblePages[0]?.id;

  const onNavKeyDown = (event: KeyboardEvent<HTMLButtonElement>, pageId: T) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>("[data-settings-nav]") ?? []);
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.findIndex((button) => button.dataset.settingsNav === pageId);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
    const button = buttons[next];
    if (!button) return;
    button.focus();
    button.click();
  };

  const navButton = (page: SettingsNavPage<T>) => <button
    key={page.id}
    type="button"
    className={`settings-nav-item${page.id === active ? " is-active" : ""}`}
    data-settings-nav={page.id}
    aria-current={page.id === active ? "page" : undefined}
    tabIndex={page.id === tabStop ? 0 : -1}
    onClick={() => onSelect(page.id)}
    onKeyDown={(event) => onNavKeyDown(event, page.id)}
  >
    <page.icon size={16} strokeWidth={1.8} aria-hidden="true" />
    <span>{page.label}</span>
  </button>;

  return <aside className="settings-sidebar" aria-label="Settings">
    <div className="settings-sidebar-head">
      <button type="button" className="settings-back" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" />
        Back to app
      </button>
      <label className="settings-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="text"
          role="searchbox"
          value={query}
          placeholder="Search settings"
          aria-label="Search settings"
          onChange={(event) => onQuery(event.target.value)}
        />
        {query ? <button type="button" className="settings-search-clear" aria-label="Clear settings search" onClick={() => onQuery("")}><X size={14} /></button> : null}
      </label>
      <label className="settings-mobile-select">
        <span>Section</span>
        <select value={visiblePages.some((page) => page.id === active) ? active : visiblePages[0]?.id ?? ""} onChange={(event) => onSelect(event.target.value as T)}>
          {visiblePages.map((page) => <option key={page.id} value={page.id}>{page.group ? `${page.group} · ${page.label}` : page.label}</option>)}
        </select>
      </label>
    </div>

    <nav className="settings-sidebar-nav" aria-label="Settings sections" ref={navRef}>
      {hasPersonalRecord ? <div className="settings-nav-group settings-nav-profile">
        <p className="settings-nav-group-label">Profile</p>
        <button
          type="button"
          className={`settings-profile-row${active === "profile" ? " is-active" : ""}`}
          data-settings-nav="profile"
          aria-current={active === "profile" ? "page" : undefined}
          tabIndex={active === "profile" ? 0 : -1}
          onClick={() => onSelect("profile" as T)}
          onKeyDown={(event) => onNavKeyDown(event, "profile" as T)}
        >
          <ProfileAvatar name={displayName ?? "Your profile"} avatarUrl={avatarUrl} />
          <span className="settings-profile-copy"><strong>{displayName ?? "Your profile"}</strong><small>Profile settings</small></span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      </div> : null}
      {groups.map((group) => <div className="settings-nav-group" key={group}>
        <p className="settings-nav-group-label">{group}</p>
        {navPages.filter((page) => page.group === group).map(navButton)}
      </div>)}
      {aboutPage ? <div className="settings-nav-about">{navButton(aboutPage)}</div> : null}
    </nav>
  </aside>;
}
