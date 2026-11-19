/** The debugger is a category workspace: one rail destination per task, not a
 * single page of controls. These records own the labels, grouping, and the
 * keyboard order the rail and the narrow section picker share. */

export type DebugSectionId = "overview" | "presets" | "session" | "workday" | "companion" | "backend" | "trace" | "export";

export type DebugSectionGroup = "Scenario" | "Safety" | "Diagnostics";

export type DebugSection = {
  id: DebugSectionId;
  label: string;
  group: DebugSectionGroup;
  detail: string;
};

export const DEBUG_SECTIONS: DebugSection[] = [
  { id: "overview", group: "Scenario", label: "Overview", detail: "What this scenario changes on this device, and where every control lives." },
  { id: "presets", group: "Scenario", label: "Presets", detail: "Load a complete scenario in one click. Loading a preset replaces every override." },
  { id: "session", group: "Scenario", label: "Session", detail: "What the app believes about sign-in, onboarding, and the page guide." },
  { id: "workday", group: "Scenario", label: "Workday", detail: "The shift, planning, and empty states the workspace renders." },
  { id: "companion", group: "Scenario", label: "Companion", detail: "The floating companion's machine state and mascot preview." },
  { id: "backend", group: "Safety", label: "Backend & writes", detail: "How far this scenario may reach, and whether writes are real." },
  { id: "trace", group: "Diagnostics", label: "Live trace", detail: "Events recorded by this device, newest first. Filters apply to the whole session." },
  { id: "export", group: "Diagnostics", label: "Export", detail: "A redacted diagnostics bundle for support. Nothing secret leaves this machine." },
];

export const DEBUG_SECTION_GROUPS: DebugSectionGroup[] = ["Scenario", "Safety", "Diagnostics"];

export function debugSection(id: DebugSectionId): DebugSection {
  return DEBUG_SECTIONS.find((section) => section.id === id) ?? DEBUG_SECTIONS[0];
}

export function sectionsInGroup(group: DebugSectionGroup): DebugSection[] {
  return DEBUG_SECTIONS.filter((section) => section.group === group);
}

/** Arrow keys move through the rail with roving focus; Home and End jump to the
 * ends. Returns null for a key the rail does not own. */
export function nextDebugSection(current: DebugSectionId, key: string): DebugSectionId | null {
  const index = DEBUG_SECTIONS.findIndex((section) => section.id === current);
  if (index < 0) return null;
  if (key === "ArrowDown") return DEBUG_SECTIONS[(index + 1) % DEBUG_SECTIONS.length].id;
  if (key === "ArrowUp") return DEBUG_SECTIONS[(index + DEBUG_SECTIONS.length - 1) % DEBUG_SECTIONS.length].id;
  if (key === "Home") return DEBUG_SECTIONS[0].id;
  if (key === "End") return DEBUG_SECTIONS[DEBUG_SECTIONS.length - 1].id;
  return null;
}
