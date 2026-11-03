/** Public Work OS employee site: one source for navigation, sections and the
 * recurring provenance line. Server-safe; no browser imports. */
export const WORK_OS_SITE = {
  product: "Work OS",
  byline: "by Wrazy",
  provenance: "Actual desktop app · Demonstration data",
  nav: [
    { label: "Overview", href: "/work-os/welcome" },
    { label: "Tutorials", href: "/work-os/welcome/tutorials" },
    { label: "Downloads", href: "/work-os/welcome/downloads" },
  ],
  wrazyos: { label: "WrazyOS", href: "https://app.wrazyos.com" },
} as const;

export type WorkOsSite = typeof WORK_OS_SITE;
