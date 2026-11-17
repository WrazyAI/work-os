import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { SETTINGS_PAGES, SettingsBlock, type SettingsPageId, type SettingsPageMeta } from "./settingsSections";
import type { PersonalSettingsProps } from "./PersonalSettings";

const ACTIVE_KEY = "work-os.settings-page";

function storedPage(): SettingsPageId | null {
  try {
    const value = localStorage.getItem(ACTIVE_KEY);
    return SETTINGS_PAGES.some((page) => page.id === value) ? value as SettingsPageId : null;
  } catch {
    return null;
  }
}

/** Settings is a category workspace: its own rail, one page at a time, and a
 * single search field. The existing settings groups keep their exact controls
 * and copy; this shell only decides where they appear. */
export function SettingsWorkspace(props: PersonalSettingsProps) {
  const pages = useMemo(
    () => SETTINGS_PAGES.filter((page) => !page.requiresPersonalRecord || props.hasPersonalRecord),
    [props.hasPersonalRecord],
  );
  const [active, setActive] = useState<SettingsPageId>(() => storedPage() ?? "general");
  const [query, setQuery] = useState("");
  const navRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const resolvedActive = pages.some((page) => page.id === active) ? active : pages[0]?.id ?? "general";
  const normalized = query.trim().toLowerCase();
  const visiblePages = useMemo(() => pages.filter((page) => {
    if (!normalized) return true;
    return [page.label, page.group, page.description, ...page.keywords]
      .some((value) => value.toLowerCase().includes(normalized));
  }), [normalized, pages]);
  const visiblePage = visiblePages.find((page) => page.id === resolvedActive) ?? null;
  const aboutPage = visiblePages.find((page) => page.id === "about") ?? null;
  const navPages = visiblePages.filter((page) => page.id !== "about");
  const groups = Array.from(new Set(navPages.map((page) => page.group))).filter(Boolean);
  const tabStop = visiblePages.some((page) => page.id === resolvedActive) ? resolvedActive : visiblePages[0]?.id;

  useEffect(() => {
    try { localStorage.setItem(ACTIVE_KEY, resolvedActive); } catch { /* best effort */ }
  }, [resolvedActive]);

  const selectPage = (page: SettingsPageId) => {
    setActive(page);
    setQuery("");
  };

  const onNavKeyDown = (event: KeyboardEvent<HTMLButtonElement>, pageId: SettingsPageId) => {
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

  const focusHeading = () => {
    window.requestAnimationFrame(() => headingRef.current?.focus());
  };

  const searchResult = (page: SettingsPageMeta) => <button key={page.id} type="button" className="settings-result" onClick={() => { selectPage(page.id); focusHeading(); }}>
    <span className="settings-result-icon" aria-hidden="true"><page.icon size={17} strokeWidth={1.8} /></span>
    <span className="settings-result-copy"><strong>{page.label}</strong><small>{page.description}</small></span>
    <span className="settings-result-group">{page.group}</span>
  </button>;

  return <div className="settings-workspace" data-active-page={resolvedActive}>
    <aside className="settings-rail" aria-label="Settings">
      <div className="settings-rail-head">
        <p className="settings-rail-eyebrow">Settings</p>
        <label className="settings-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="text"
            role="searchbox"
            value={query}
            placeholder="Search settings"
            aria-label="Search settings"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? <button type="button" className="settings-search-clear" aria-label="Clear settings search" onClick={() => setQuery("")}><X size={14} /></button> : null}
        </label>
        <label className="settings-mobile-select">
          <span>Section</span>
          <select value={visiblePages.some((page) => page.id === resolvedActive) ? resolvedActive : visiblePages[0]?.id ?? ""} onChange={(event) => { selectPage(event.target.value as SettingsPageId); focusHeading(); }}>
            {visiblePages.map((page) => <option key={page.id} value={page.id}>{page.group ? `${page.group} · ${page.label}` : page.label}</option>)}
          </select>
        </label>
      </div>

      <nav className="settings-rail-nav" aria-label="Settings sections" ref={navRef}>
        {groups.map((group) => <div className="settings-nav-group" key={group}>
          <p className="settings-nav-group-label">{group}</p>
          {navPages.filter((page) => page.group === group).map((page) => <button
            key={page.id}
            type="button"
            className={`settings-nav-item${page.id === resolvedActive ? " is-active" : ""}`}
            data-settings-nav={page.id}
            aria-current={page.id === resolvedActive ? "page" : undefined}
            tabIndex={page.id === tabStop ? 0 : -1}
            onClick={() => selectPage(page.id)}
            onKeyDown={(event) => onNavKeyDown(event, page.id)}
          >
            <page.icon size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>{page.label}</span>
          </button>)}
        </div>)}
        {aboutPage ? <div className="settings-nav-about">
          <button
            type="button"
            className={`settings-nav-item${aboutPage.id === resolvedActive ? " is-active" : ""}`}
            data-settings-nav={aboutPage.id}
            aria-current={aboutPage.id === resolvedActive ? "page" : undefined}
            tabIndex={aboutPage.id === tabStop ? 0 : -1}
            onClick={() => selectPage(aboutPage.id)}
            onKeyDown={(event) => onNavKeyDown(event, aboutPage.id)}
          >
            <aboutPage.icon size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>{aboutPage.label}</span>
          </button>
        </div> : null}
      </nav>
    </aside>

    <section className="settings-content" ref={contentRef} aria-labelledby="settings-page-title">
      {visiblePage ? <>
        <header className="settings-content-head">
          <p className="settings-content-eyebrow">{visiblePage.group || "Settings"}</p>
          <h2 id="settings-page-title" ref={headingRef} tabIndex={-1}>{visiblePage.label}</h2>
          <p>{visiblePage.description}</p>
        </header>
        <div className="settings-content-body" data-hide-first-head={visiblePage.hideFirstGroupHead ? "true" : undefined}>
          {visiblePage.blocks.map((block) => <SettingsBlock key={block} block={block} {...props} />)}
        </div>
      </> : normalized && visiblePages.length ? <>
        <header className="settings-content-head">
          <p className="settings-content-eyebrow">Search</p>
          <h2 id="settings-page-title" tabIndex={-1}>Results for “{query.trim()}”</h2>
          <p>Choose the settings page that holds what you need.</p>
        </header>
        <div className="settings-search-results">{visiblePages.map(searchResult)}</div>
      </> : <div className="settings-empty">
        <Search size={22} aria-hidden="true" />
        <h2 id="settings-page-title" tabIndex={-1}>No settings match</h2>
        <p>Try a different word, or clear the search to see every page.</p>
        <button type="button" className="quiet-action" onClick={() => setQuery("")}>Clear search</button>
      </div>}
    </section>
  </div>;
}
