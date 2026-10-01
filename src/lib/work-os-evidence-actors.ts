/* Grouping for unattributed provider evidence actors.
 *
 * The Evidence page surfaces GitHub accounts that produced evidence before an
 * administrator mapped them, so setup order never loses work. Grouping is by
 * the actor's login (case-insensitive) when present, else the numeric id, so a
 * push authored by `david-z-9900` and a pull request from the same account land
 * in one row. Pure functions so the rendered surface stays deterministic. */

type Json = Record<string, unknown>;

export interface EvidenceActorIdentity {
  id: string | null;
  login: string | null;
}

export interface EvidenceActorSummary extends EvidenceActorIdentity {
  key: string;
  events: number;
  firstSeen: string | null;
  lastSeen: string | null;
  titles: string[];
}

export interface EvidenceActorPersonSuggestion {
  personId: string;
  displayName: string;
  githubUsername: string;
}

export function actorFromEvidenceRow(row: Json): EvidenceActorIdentity {
  const metadata = (row.metadata ?? {}) as Json;
  const metadataActor = (metadata.actor ?? {}) as Json;
  const raw = (row.raw ?? {}) as Json;
  const rawSender = (raw.sender ?? {}) as Json;
  const id = metadataActor.id ?? rawSender.id;
  const login = metadataActor.login ?? rawSender.login;
  return {
    id: id != null && String(id).trim() ? String(id) : null,
    login: typeof login === "string" && login.trim() ? login.trim() : null,
  };
}

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function groupEvidenceActors(rows: Json[]): EvidenceActorSummary[] {
  const groups = new Map<string, EvidenceActorSummary>();
  for (const row of rows) {
    if (row.person_id) continue;
    const actor = actorFromEvidenceRow(row);
    if (!actor.id && !actor.login) continue;
    const key = actor.login ? `login:${actor.login.toLowerCase()}` : `id:${actor.id}`;
    const at = isoOrNull(row.occurred_at);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        id: actor.id,
        login: actor.login,
        events: 1,
        firstSeen: at,
        lastSeen: at,
        titles: row.title ? [String(row.title)] : [],
      });
      continue;
    }
    existing.events += 1;
    if (actor.id && !existing.id) existing.id = actor.id;
    if (actor.login && !existing.login) existing.login = actor.login;
    if (at && (!existing.lastSeen || at > existing.lastSeen)) existing.lastSeen = at;
    if (at && (!existing.firstSeen || at < existing.firstSeen)) existing.firstSeen = at;
    if (existing.titles.length < 3 && row.title) existing.titles.push(String(row.title));
  }
  return [...groups.values()].sort((left, right) => String(right.lastSeen ?? "").localeCompare(String(left.lastSeen ?? "")));
}

export function suggestPersonForActor(
  actor: EvidenceActorIdentity,
  people: Array<{ id: string; display_name: string; github_username: string | null }>,
): EvidenceActorPersonSuggestion | null {
  if (!actor.login) return null;
  const login = actor.login.toLowerCase();
  const match = people.find((person) => (person.github_username ?? "").trim().toLowerCase() === login);
  return match ? { personId: String(match.id), displayName: String(match.display_name), githubUsername: String(match.github_username) } : null;
}
