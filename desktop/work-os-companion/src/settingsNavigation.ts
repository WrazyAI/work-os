import { useEffect, useMemo, useState } from "react";
import { SETTINGS_PAGES, type SettingsNavPage, type SettingsPageId, type SettingsPageMeta } from "./settingsSections";

const STORAGE_KEY = "work-os.settings-page";

function storedPage(): SettingsPageId | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return SETTINGS_PAGES.some((page) => page.id === value) ? value as SettingsPageId : null;
  } catch {
    return null;
  }
}

export function filterSettingsPages<T extends SettingsNavPage>(pages: T[], query: string): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return pages;
  return pages.filter((page) => [page.label, page.group, page.description, ...page.keywords]
    .some((value) => value.toLowerCase().includes(normalized)));
}

/** Shared state for the Settings rail and the Settings content pane. The rail
 * replaces the Work OS sidebar while Settings is on screen, so both siblings
 * need the same active page, search query, and record-dependent page list. */
export function useSettingsNavigation(hasPersonalRecord: boolean) {
  const pages = useMemo(
    () => SETTINGS_PAGES.filter((page) => !page.requiresPersonalRecord || hasPersonalRecord),
    [hasPersonalRecord],
  );
  const [requested, setRequested] = useState<SettingsPageId>(() => storedPage() ?? "general");
  const [query, setQuery] = useState("");
  const active = pages.some((page) => page.id === requested) ? requested : pages[0]?.id ?? "general";
  const visiblePages = useMemo(() => filterSettingsPages(pages, query), [pages, query]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, active); } catch { /* best effort */ }
  }, [active]);

  const selectPage = (page: SettingsPageId) => {
    setRequested(page);
    setQuery("");
  };

  return { active, pages, visiblePages, query, setQuery, selectPage };
}
