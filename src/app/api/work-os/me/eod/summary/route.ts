import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gatherEodGrounding, streamEodSummary } from "@/lib/aiEod";
import { eodDraftShiftGate } from "@/lib/work-os-eod-shift-gate";
import { EOD_SHIFT_OPEN_REASON } from "@/lib/work-os-shift-gate";
import { assembleEodSummary } from "@/lib/work-os-eod-structured";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { cleanEodLines, emptyEodStructuredReport } from "@/modules/work-os/eod-structured";

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
    const body = await req.json().catch(() => ({})) as {
      date?: unknown;
      completed?: unknown;
      inProgress?: unknown;
      next?: unknown;
    };
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date().toISOString().slice(0, 10);
    const completed = cleanEodLines(body.completed);
    const inProgress = cleanEodLines(body.inProgress);
    const next = cleanEodLines(body.next);
    if (!completed.length || !inProgress.length || !next.length) {
      return NextResponse.json({ error: "All three sections need at least one line before the summary is written." }, { status: 400 });
    }
    const personId = auth.access.personId as string;
    const gate = await eodDraftShiftGate(auth.access, personId, date);
    if (gate.blocked) {
      return NextResponse.json({ error: gate.message, reason: EOD_SHIFT_OPEN_REASON }, { status: 409 });
    }
    const person = await createAdminClient().from("work_people")
      .select("display_name")
      .eq("organization_id", auth.access.organizationId)
      .eq("id", personId)
      .maybeSingle();
    if (person.error) throw new Error(`load EOD person for summary: ${person.error.message}`);
    const grounding = await gatherEodGrounding(
      auth.access.organizationId,
      personId,
      date,
      String(person.data?.display_name ?? "The employee"),
    );
    const result = await streamEodSummary(grounding, { completed, inProgress, next });
    if (result.ok) {
      return new Response(result.stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Work-OS-Summary-Source": "otto",
        },
      });
    }
    const fallback = assembleEodSummary({
      ...emptyEodStructuredReport(),
      completed,
      inProgress,
      next,
    });
    if (!fallback) {
      return NextResponse.json({ error: "The summary could not be written. Try again." }, { status: 503 });
    }
    return new Response(fallback, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Work-OS-Summary-Source": "assembled",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
