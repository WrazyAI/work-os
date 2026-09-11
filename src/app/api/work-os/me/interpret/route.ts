import { NextResponse } from "next/server";
import { interpretWorkUpdate, loadInterpretationTasks } from "@/lib/aiInterpret";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { getWorkOsOrganizationOwnerId } from "@/lib/work-os";
import { persistInterpretHistory, recentConversationTurns } from "@/lib/work-conversations";
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
    const interpretContext = memoryEnabled(auth.access.featureFlags)
      ? {
          todayBlock: await buildTodaySnapshot(conversationScope),
          memoryBlock: await buildMemoryPromptBlock(conversationScope, body.input, { limit: 8 }),
          conversation: await recentConversationTurns(conversationScope, 8),
        }
      : undefined;
    const result = await interpretWorkUpdate(body, tasks, interpretContext);
    if (!result.ok) {
      const status = result.reason === "ai_unconfigured" ? 501 : 503;
      return NextResponse.json({ error: result.detail ?? "AI interpretation unavailable", reason: result.reason }, { status });
    }
    await persistInterpretHistory(conversationScope, body.history, body.input);
    return NextResponse.json({ interpretation: result.interpretation, model: result.model });
  } catch (error) {
    return jsonError(error);
  }
}
