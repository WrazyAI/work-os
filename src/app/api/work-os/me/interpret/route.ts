import { NextResponse } from "next/server";
import { interpretWorkUpdate, loadInterpretationTasks, type InterpretContext } from "@/lib/aiInterpret";
import { buildLoomAttachment } from "@/lib/aiLoom";
import { findLoomReference, loomMetadataEnabled } from "@/lib/work-os-loom";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { getWorkOsOrganizationOwnerId, listBlueprints } from "@/lib/work-os";
import { loadShiftData } from "@/lib/work-os-internal";
import { persistInterpretHistory, recentConversationTurns } from "@/lib/work-conversations";
import { annotateBatchStatusNames } from "@/lib/aiBatchLabels";
import { buildMemoryPromptBlock, memoryEnabled } from "@/lib/work-memory";
import { buildTodaySnapshot } from "@/lib/work-memory-today";

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
    const body = (await req.json()) as { input?: unknown; planIntent?: unknown; today?: unknown; history?: unknown };
    if (typeof body?.input !== "string" || !body.input.trim()) {
      return NextResponse.json({ error: "input is required" }, { status: 400 });
    }
    const ownerId = await getWorkOsOrganizationOwnerId(auth.access.organizationId);
    let tasks;
    try {
      tasks = await loadInterpretationTasks(ownerId, auth.access.personId as string);
    } catch (error) {
      return NextResponse.json({
        error: "Nifty tasks could not be loaded. You can still record this update manually.",
        reason: "nifty_failure",
      }, { status: 502 });
    }
    const localDate = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
      ? body.today
      : new Date().toISOString().slice(0, 10);
    const conversationScope = {
      organizationId: auth.access.organizationId,
      personId: auth.access.personId as string,
      localDate,
    };
    const memoryContext = memoryEnabled(auth.access.featureFlags)
      ? {
          todayBlock: await buildTodaySnapshot(conversationScope),
          memoryBlock: await buildMemoryPromptBlock(conversationScope, body.input, { limit: 8 }),
          conversation: await recentConversationTurns(conversationScope, 8),
        }
      : {};
    // A Loom link anywhere in the update reaches the analyze tool; its output
    // is attached as tool context and never filed on its own. Enrichment is
    // strictly optional: schedule/network/AI failures must never block the
    // plain-text interpretation.
    let loomContext: InterpretContext["loom"];
    if (loomMetadataEnabled(auth.access.featureFlags) && findLoomReference(body.input)) {
      try {
        const { timezone } = await loadShiftData(auth.access, auth.access.personId as string, new Date());
        const attachment = await buildLoomAttachment({
          text: body.input,
          targetDate: localDate,
          timezone,
          existingTaskTitles: tasks.map((task) => task.title).slice(0, 60),
        });
        loomContext = attachment?.attachment;
      } catch {
        loomContext = undefined;
      }
    }
    // A template list makes plan_import usable. It is optional context: a
    // blueprint read failure must never block the plain-text interpretation.
    let blueprints: InterpretContext["blueprints"];
    try {
      const rows = await listBlueprints(ownerId);
      blueprints = (rows as Array<Record<string, unknown>>).map((blueprint) => ({
        id: String(blueprint.id),
        name: String(blueprint.name ?? "Blueprint"),
        taskCount: Array.isArray(blueprint.phases)
          ? (blueprint.phases as Array<{ tasks?: unknown[] }>).reduce((total, phase) => total + (phase.tasks?.length ?? 0), 0)
          : 0,
      })).filter((blueprint) => blueprint.taskCount > 0);
    } catch {
      blueprints = undefined;
    }
    const interpretContext: InterpretContext = {
      ...memoryContext,
      ...(loomContext ? { loom: loomContext } : {}),
      ...(blueprints?.length ? { blueprints } : {}),
    };
    const result = await interpretWorkUpdate(body, tasks, interpretContext);
    if (!result.ok) {
      const status = result.reason === "ai_unconfigured" ? 501 : 503;
      return NextResponse.json({ error: result.detail ?? "AI interpretation unavailable", reason: result.reason }, { status });
    }
    // Status names for the batch card: the employee's own task rows already carry
    // both the column id and the human status, so a status move can read
    // "In review → Done" without an extra query. Entries we cannot name keep no
    // label at all — a raw column id must never reach the card.
    annotateBatchStatusNames(result.interpretation, tasks);
    await persistInterpretHistory(conversationScope, body.history, body.input);
    return NextResponse.json({ interpretation: result.interpretation, model: result.model });
  } catch (error) {
    return jsonError(error);
  }
}
