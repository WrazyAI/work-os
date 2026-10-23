import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { listWorkOsWorkspaces } from "@/lib/work-os-api";
import {
  safeWorkOsWorkspaceNext,
  WORK_OS_WORKSPACE_COOKIE,
  WORK_OS_WORKSPACE_COOKIE_MAX_AGE,
  WORK_OS_WORKSPACE_FIELD,
  WORK_OS_WORKSPACE_NEXT_FIELD,
  WORK_OS_WORKSPACE_SELECT,
} from "@/modules/work-os/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Relative Location so redirects keep working behind the platform proxy. */
function redirectTo(path: string) {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: path, "Cache-Control": "no-store" },
  });
}

function requestIsSecure(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]?.trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

function chosenOrganization(input: FormData | Record<string, unknown> | null): string {
  if (!input) return "";
  if (input instanceof FormData) return String(input.get(WORK_OS_WORKSPACE_FIELD) ?? "");
  return String(input[WORK_OS_WORKSPACE_FIELD] ?? "");
}

function chosenNext(input: FormData | Record<string, unknown> | null): unknown {
  if (!input) return null;
  if (input instanceof FormData) return input.get(WORK_OS_WORKSPACE_NEXT_FIELD);
  return input[WORK_OS_WORKSPACE_NEXT_FIELD];
}

/**
 * Choose the workspace this device will open.
 *
 * A plain form POST from the chooser (and the desktop connect page). The
 * requested id is checked against the account's own active memberships before
 * the cookie is written; the cookie selects among verified memberships and is
 * never an authorization boundary. The JSON shape exists for the connect page's
 * client-side flow and the chooser's progressive enhancement.
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  const profile = await getCurrentProfile();
  if (!profile) {
    if (isJson) return NextResponse.json({ error: "authentication required" }, { status: 401 });
    return redirectTo("/login");
  }

  const input = isJson
    ? await request.json().catch(() => null) as Record<string, unknown> | null
    : await request.formData().catch(() => null);
  const organizationId = chosenOrganization(input);
  const workspaces = await listWorkOsWorkspaces(profile.id);
  const workspace = workspaces.find((candidate) => candidate.organizationId === organizationId);

  if (!workspace) {
    if (isJson) {
      return NextResponse.json({ error: "workspace is not available to this account" }, { status: 403 });
    }
    return redirectTo(`${WORK_OS_WORKSPACE_SELECT}?error=forbidden`);
  }

  const next = safeWorkOsWorkspaceNext(chosenNext(input));
  const response = isJson
    ? NextResponse.json({
        organizationId: workspace.organizationId,
        organizationName: workspace.name,
        role: workspace.role,
      }, { headers: { "Cache-Control": "no-store" } })
    : redirectTo(next);

  response.cookies.set({
    name: WORK_OS_WORKSPACE_COOKIE,
    value: workspace.organizationId,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: WORK_OS_WORKSPACE_COOKIE_MAX_AGE,
    secure: requestIsSecure(request),
  });
  return response;
}
