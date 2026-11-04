/** Public Work OS employee site: one source for navigation, sections and the
 * recurring provenance line. Server-safe; no browser imports. */
export const WORK_OS_SITE = {
  product: "Work OS",
  byline: "by Wrazy",
  provenance: "Actual desktop app · Demonstration data",
  home: "/work-os",
  downloads: "/work-os/downloads",
  tutorials: "/work-os/tutorials",
  nav: [
    { label: "Overview", href: "/work-os" },
    { label: "Tutorials", href: "/work-os/tutorials" },
    { label: "Downloads", href: "/work-os/downloads" },
  ],
  // The site is served from the WrazyOS origin, so the homepage is the local
  // root. An absolute app.wrazyos.com link would leave local previews and
  // alternate hosts pointing at production.
  wrazyos: { label: "WrazyOS", href: "/" },
} as const;

export type WorkOsSite = typeof WORK_OS_SITE;

/** Compatibility aliases for links and bookmarks created before the site moved
 * from /work-os/welcome to the /work-os root. The pages redirect; these paths
 * still have to be public so an anonymous visitor reaches that redirect. */
export const WORK_OS_LEGACY_SITE = {
  home: "/work-os/welcome",
  downloads: "/work-os/welcome/downloads",
  tutorials: "/work-os/welcome/tutorials",
} as const;

const TUTORIAL_SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * True only for the public Work OS site.
 *
 * `/work-os` is the site root; the workspace dispatcher lives at
 * `/work-os/workspace`, so the prefix alone can never be public. Keep this
 * exact: opening the prefix would expose `/work-os/today`, `/work-os/review`
 * and every adjacent account surface.
 */
export function isWorkOsSitePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // Next canonicalizes a trailing slash after the proxy runs. Classify it here
  // too so `/work-os/` reaches that redirect instead of /login.
  const candidate = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (
    candidate === WORK_OS_SITE.home
    || candidate === WORK_OS_SITE.downloads
    || candidate === WORK_OS_SITE.tutorials
    || candidate === WORK_OS_LEGACY_SITE.home
    || candidate === WORK_OS_LEGACY_SITE.downloads
    || candidate === WORK_OS_LEGACY_SITE.tutorials
  ) return true;

  const canonical = `${WORK_OS_SITE.tutorials}/`;
  const legacy = `${WORK_OS_LEGACY_SITE.tutorials}/`;
  if (candidate.startsWith(canonical)) return TUTORIAL_SLUG.test(candidate.slice(canonical.length));
  if (candidate.startsWith(legacy)) return TUTORIAL_SLUG.test(candidate.slice(legacy.length));
  return false;
}
