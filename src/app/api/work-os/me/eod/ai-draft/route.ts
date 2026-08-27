import { NextResponse } from "next/server";
import { draftEodNarrative, gatherEodGrounding } from "@/lib/aiEod";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const body = (await req.json().catch(() => ({}))) as { date?: unknown };
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date().toISOString().slice(0, 10);
    const personId = auth.access.personId as string;
    const personResult = await createAdminClient().from("work_people").select("display_name")
      .eq("organization_id", auth.access.organizationId).eq("id", personId).maybeSingle();
    if (personResult.error) throw new Error(`load person for EOD draft: ${personResult.error.message}`);
    const grounding = await gatherEodGrounding(auth.access.organizationId, personId, date, String(personResult.data?.display_name ?? "The employee"));
    const result = await draftEodNarrative(grounding);
    if (!result.ok) {
      const status = result.reason === "ai_unconfigured" ? 501 : 503;
      return NextResponse.json({ error: result.detail ?? "AI EOD drafting unavailable", reason: result.reason }, { status });
    }
    return NextResponse.json({ markdown: result.markdown, model: result.model });
  } catch (error) {
    return jsonError(error);
  }
}
