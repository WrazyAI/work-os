import { NextResponse } from "next/server";
import { requireAdminOttoAccess } from "@/lib/work-os-admin-otto-access";
import {
  executeAdminOttoChat,
  loadAdminOttoThread,
} from "@/lib/work-os-admin-otto-chat";
import { AdminOttoIntentUnavailableError } from "@/lib/work-os-admin-otto-intent";
import { hasExpectedPublicOrigin } from "@/lib/request-origin";
import { jsonError, WorkOsConflictError, WorkOsValidationError } from "@/lib/work-os-api";
import { isWorkOsMigrationRequired } from "@/lib/work-os";
import type { ChatRequest } from "@/modules/work-os/admin-otto/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every chat response, including a denial or a model outage, carries the
 * versioned no-store envelope. */
async function wired(response: NextResponse | Response) {
  const body = await response.json().catch(() => ({}));
  return NextResponse.json({ schemaVersion: 1, ...body }, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

function objectBody(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Known validation/conflict errors keep their safe message and reason code.
 * Unknown database/provider internals never reach the admin client. */
function safeError(error: unknown) {
  if (error instanceof WorkOsConflictError || error instanceof WorkOsValidationError) {
    return wired(jsonError(error));
  }
  if (isWorkOsMigrationRequired(error)) {
    return wired(NextResponse.json({
      error: "Work OS database migration required.",
      reason: "migration_required",
    }, { status: 503 }));
  }
  console.error("[admin-otto-chat] request failed", error instanceof Error ? error.message : error);
  return wired(NextResponse.json({
    error: "Admin Otto chat failed. Try again.",
    reason: "internal_error",
  }, { status: 500 }));
}

function outageMessage(reason: AdminOttoIntentUnavailableError["reason"]): string {
  if (reason === "ai_unconfigured") return "Admin Otto is not configured on this server.";
  if (reason === "ai_malformed") return "Admin Otto could not understand that request. Retry with a clearer read request.";
  return "Admin Otto is temporarily unavailable. Retry.";
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminOttoAccess(req, "read");
    if (auth.response) return wired(auth.response);
    // Cookie-authenticated conversation writes need the app origin; native
    // desktop bearer clients keep their existing no-origin contract.
    if (!req.headers.get("authorization") && !hasExpectedPublicOrigin(req)) {
      return wired(NextResponse.json({ error: "invalid origin" }, { status: 403 }));
    }
    const parsed = await req.json().catch(() => null);
    if (!objectBody(parsed)) {
      return wired(NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 }));
    }
    if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1) {
      return wired(NextResponse.json({ error: "Unsupported schema version" }, { status: 400 }));
    }
    const result = await executeAdminOttoChat(auth.access, parsed as unknown as ChatRequest, {
      // Read reauthorization, not the voice-gated Task 1 helper: an admin
      // without voice_input can still use the read-only chat.
      revalidateAccess: async () => {
        const fresh = await requireAdminOttoAccess(req, "read");
        if (fresh.response) throw fresh.response;
        return fresh.access;
      },
    });
    return wired(NextResponse.json(result, { headers: { "Cache-Control": "no-store" } }));
  } catch (error) {
    if (error instanceof AdminOttoIntentUnavailableError) {
      return wired(NextResponse.json({
        error: outageMessage(error.reason),
        reason: error.reason,
      }, { status: 503 }));
    }
    if (error instanceof Response) return wired(error);
    return safeError(error);
  }
}

/** Bounded rehydration for the shared chat surface: the last 24 turns inside
 * the 30-day retention window, plus a result re-run from typed source refs. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOttoAccess(req, "read");
    if (auth.response) return wired(auth.response);
    const conversationId = new URL(req.url).searchParams.get("conversationId");
    if (!conversationId) {
      return wired(NextResponse.json({ error: "conversationId is required" }, { status: 400 }));
    }
    const view = await loadAdminOttoThread(auth.access, conversationId, {
      revalidateAccess: async () => {
        const fresh = await requireAdminOttoAccess(req, "read");
        if (fresh.response) throw fresh.response;
        return fresh.access;
      },
    });
    return wired(NextResponse.json(view, { headers: { "Cache-Control": "no-store" } }));
  } catch (error) {
    if (error instanceof Response) return wired(error);
    return safeError(error);
  }
}
