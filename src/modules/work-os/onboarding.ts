export const WORK_PROFILE_CATALOG_VERSION = "2026-08-12.1";

export type ProfileItemKind = "responsibility" | "deliverable" | "evidence";
export type ProfileItemSource = "imported" | "suggested" | "user";

export interface WorkProfileItem {
  id: string;
  kind: ProfileItemKind;
  label: string;
  source: ProfileItemSource;
}

export interface WorkArchetype {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  specialties: Array<{ id: string; name: string }>;
  items: WorkProfileItem[];
}

const item = (archetype: string, kind: ProfileItemKind, label: string): WorkProfileItem => ({
  id: `${archetype}:${kind}:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
  kind,
  label,
  source: "suggested",
});

function archetype(
  id: string,
  name: string,
  description: string,
  keywords: string[],
  specialties: string[],
  responsibilities: string[],
  deliverables: string[],
  evidence: string[],
): WorkArchetype {
  return {
    id, name, description, keywords,
    specialties: specialties.map((name) => ({ id: `${id}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name })),
    items: [
      ...responsibilities.map((label) => item(id, "responsibility", label)),
      ...deliverables.map((label) => item(id, "deliverable", label)),
      ...evidence.map((label) => item(id, "evidence", label)),
    ],
  };
}

export const WORK_ARCHETYPES: WorkArchetype[] = [
  archetype("engineering", "Engineering", "Build and operate reliable software systems.", ["engineer", "developer", "software", "devops", "qa", "data"], ["Frontend", "Backend", "Mobile", "Platform", "Data", "Quality"], ["Design and implement software", "Review and improve code", "Diagnose defects and incidents", "Maintain technical quality"], ["Code changes", "Pull requests", "Tests", "Deployments", "Technical documents"], ["Nifty", "GitHub", "Build and deployment systems"]),
  archetype("product", "Product", "Turn customer and business context into focused product decisions.", ["product", "product manager", "program manager"], ["Discovery", "Strategy", "Delivery", "Analytics", "Platform"], ["Define product outcomes", "Prioritize opportunities", "Coordinate delivery", "Learn from customers and usage"], ["Product briefs", "Roadmaps", "Requirements", "Experiment readouts", "Launch plans"], ["Nifty", "Product analytics", "Research repositories"]),
  archetype("design", "Design", "Shape useful, coherent experiences and product systems.", ["design", "designer", "ux", "ui", "researcher"], ["Product design", "Research", "Content design", "Design systems", "Brand"], ["Explore user problems", "Design product experiences", "Maintain design consistency", "Validate solutions"], ["Flows and prototypes", "Research findings", "Design specifications", "Content systems"], ["Nifty", "Figma", "Research repositories"]),
  archetype("marketing", "Marketing & Growth", "Create demand, communicate value, and improve acquisition.", ["marketing", "growth", "seo", "content", "brand"], ["Content", "Lifecycle", "Performance", "SEO", "Brand", "Community"], ["Plan campaigns", "Create and distribute content", "Measure channel performance", "Improve audience conversion"], ["Campaigns", "Content assets", "Channel reports", "Experiments", "Positioning"], ["Nifty", "Analytics platforms", "Publishing platforms"]),
  archetype("sales", "Sales", "Create qualified opportunities and move buyers toward a decision.", ["sales", "account executive", "business development", "bdr", "sdr"], ["Prospecting", "Account management", "Solutions", "Partnerships", "Revenue operations"], ["Develop qualified pipeline", "Understand buyer needs", "Progress opportunities", "Maintain account context"], ["Qualified opportunities", "Discovery notes", "Proposals", "Forecast updates"], ["Nifty", "CRM", "Call and meeting systems"]),
  archetype("support", "Customer Support & Success", "Resolve customer needs and help accounts realize value.", ["support", "customer success", "customer service", "service representative", "helpdesk"], ["Technical support", "Customer success", "Onboarding", "Escalations", "Education"], ["Resolve customer requests", "Guide customer adoption", "Document recurring issues", "Coordinate escalations"], ["Resolved conversations", "Account updates", "Help content", "Escalation summaries"], ["Nifty", "Support platform", "CRM and call systems"]),
  archetype("operations", "Operations", "Make recurring business processes dependable and visible.", ["operations", "operator", "project manager", "coordinator", "logistics"], ["Business operations", "Project delivery", "Vendor operations", "Quality", "Logistics"], ["Run operational workflows", "Coordinate dependencies", "Improve process reliability", "Resolve operational blockers"], ["Completed workflows", "Operating reports", "Process documentation", "Delivery plans"], ["Nifty", "Operational systems", "Shared documents"]),
  archetype("people-finance", "People & Finance", "Support healthy teams and responsible business operations.", ["people", "human resources", "hr", "finance", "accounting", "recruiter"], ["People operations", "Recruiting", "Learning", "Accounting", "Planning", "Compliance"], ["Support employee or financial operations", "Maintain accurate records", "Coordinate review cycles", "Improve policy and process clarity"], ["Completed cases", "Reports", "Reconciliations", "Hiring or people plans", "Policy documents"], ["Nifty", "HR or finance systems", "Approved documents"]),
];

export const CUSTOM_ARCHETYPE: WorkArchetype = {
  id: "custom", name: "Something else", description: "Describe a role that does not fit the standard scopes.", keywords: [], specialties: [], items: [],
};

export function workProfileCatalog() {
  return { version: WORK_PROFILE_CATALOG_VERSION, archetypes: [...WORK_ARCHETYPES, CUSTOM_ARCHETYPE] };
}

export function inferArchetype(title: string | null | undefined): string | null {
  const normalized = String(title ?? "").trim().toLowerCase();
  if (!normalized) return null;
  let best: { id: string; score: number } | null = null;
  for (const candidate of WORK_ARCHETYPES) {
    const score = candidate.keywords.reduce((total, keyword) => total + (normalized.includes(keyword) ? keyword.length : 0), 0);
    if (score && (!best || score > best.score)) best = { id: candidate.id, score };
  }
  return best?.id ?? null;
}

export function validateArchetypeSelection(archetypeId: unknown, specialtyIds: unknown) {
  const archetype = [...WORK_ARCHETYPES, CUSTOM_ARCHETYPE].find((candidate) => candidate.id === archetypeId);
  if (!archetype) throw new Error("Select a valid work archetype.");
  const requested = Array.isArray(specialtyIds) ? [...new Set(specialtyIds.map(String))] : [];
  const valid = new Set(archetype.specialties.map((specialty) => specialty.id));
  if (requested.some((id) => !valid.has(id))) throw new Error("One or more specialties do not belong to the selected archetype.");
  return { archetype, specialtyIds: requested.slice(0, 12) };
}

export function normalizeProfileItems(input: unknown, fallback: Partial<Record<ProfileItemKind, unknown>> = {}): WorkProfileItem[] {
  const kinds: ProfileItemKind[] = ["responsibility", "deliverable", "evidence"];
  if (Array.isArray(input)) {
    const seen = new Set<string>();
    return input.flatMap((raw, index) => {
      if (!raw || typeof raw !== "object") return [];
      const row = raw as Record<string, unknown>;
      const kind = kinds.includes(row.kind as ProfileItemKind) ? row.kind as ProfileItemKind : null;
      const label = typeof row.label === "string" ? row.label.trim().slice(0, 120) : "";
      const source = ["imported", "suggested", "user"].includes(String(row.source)) ? row.source as ProfileItemSource : "user";
      const dedupe = `${kind}:${label.toLowerCase()}`;
      if (!kind || !label || seen.has(dedupe)) return [];
      seen.add(dedupe);
      return [{ id: typeof row.id === "string" && row.id.trim() ? row.id.slice(0, 180) : `user:${kind}:${index}`, kind, label, source }];
    }).slice(0, 90);
  }
  return kinds.flatMap((kind) => Array.isArray(fallback[kind])
    ? (fallback[kind] as unknown[]).map((label, index) => ({ id: `legacy:${kind}:${index}`, kind, label: String(label).trim().slice(0, 120), source: "user" as const })).filter((entry) => entry.label)
    : []);
}
