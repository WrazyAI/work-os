import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { githubAdminTokenConfigured, githubWebhookSecret } from "@/lib/integrations/github";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";
import { groupEvidenceActors, suggestPersonForActor } from "@/lib/work-os-evidence-actors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unattributed GitHub evidence actors for the admin Evidence page, with the
 * people a login could belong to (matched against the employee-supplied
 * github_username) and the integration's configuration state. */
export async function GET(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"));
  if ("response" in auth) return auth.response;
  try {
    const db = createAdminClient();
    const organizationId = auth.access.organizationId;
    const [events, people] = await Promise.all([
      db.from("work_evidence_events")
        .select("id,title,person_id,occurred_at,metadata,raw")
        .eq("organization_id", organizationId)
        .eq("provider", "github")
        .is("person_id", null)
        .order("occurred_at", { ascending: false })
        .limit(500),
      db.from("work_people")
        .select("id,display_name,github_username")
        .eq("organization_id", organizationId)
        .eq("active", true),
    ]);
    if (events.error) throw new Error(`load unattributed GitHub evidence: ${events.error.message}`);
    if (people.error) throw new Error(`load evidence people: ${people.error.message}`);
    const rows = (events.data ?? []) as Array<Record<string, unknown>>;
    const actors = groupEvidenceActors(rows).map((actor) => ({
      ...actor,
      suggestion: suggestPersonForActor(actor, (people.data ?? []) as Array<{ id: string; display_name: string; github_username: string | null }>),
    }));
    return NextResponse.json({
      actors,
      people: (people.data ?? []).map((person: Record<string, unknown>) => ({
        id: String(person.id),
        displayName: String(person.display_name),
        githubUsername: person.github_username ? String(person.github_username) : null,
      })),
      totals: {
        unattributedEvents: rows.length,
        lastEventAt: rows.length ? rows[0]?.occurred_at ?? null : null,
      },
      configuration: {
        webhookReceiverReady: Boolean(githubWebhookSecret()),
        repositoryManagementReady: githubAdminTokenConfigured(),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
