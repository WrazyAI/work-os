import { NextResponse } from "next/server";
import { requireWorkOsAccess } from "@/lib/work-os-api";
import {
  parseWorkOsViewMode,
  safeWorkOsViewNext,
  workOsViewSelectionLocation,
  WORK_OS_VIEW_COOKIE,
  WORK_OS_VIEW_MODE_FIELD,
  WORK_OS_VIEW_NEXT_FIELD,
} from "@/modules/work-os/view-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

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

function viewModeCookie(request: Request, mode: "employee" | "admin") {
  return {
    name: WORK_OS_VIEW_COOKIE,
    value: mode,
    path: "/",
    sameSite: "lax" as const,
    httpOnly: true,
    maxAge: ONE_YEAR_SECONDS,
    secure: requestIsSecure(request),
  };
}

/**
 * Switch the signed-in administrator between Administration and My workspace.
 *
 * A plain form POST from the sidebar or a workspace masthead. The cookie is a
 * per-device presentation preference, never authorization: the administrator
 * role and person mapping are validated here, and employee mode is only stored
 * for an administrator that actually has a workday to enter.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return redirectTo("/work-os");

  const requested = parseWorkOsViewMode(form.get(WORK_OS_VIEW_MODE_FIELD));
  const auth = await requireWorkOsAccess({});
  if (auth.response) {
    if (auth.response.headers.get("x-work-os-workspace-selection") === "required") {
      // The switch must survive the chooser: store the chosen view before the
      // workspace is picked, and carry its destination through the redirect.
      // Without this, choosing a workspace returns to the view being left and
      // a multi-workspace account looks stuck in one direction.
      const response = redirectTo(workOsViewSelectionLocation(requested, form.get(WORK_OS_VIEW_NEXT_FIELD)));
      response.cookies.set(viewModeCookie(request, requested));
      return response;
    }
    return redirectTo("/login");
  }
  if (auth.access.role !== "admin") return redirectTo("/work-os");
  if (requested === "employee" && !auth.access.personId) return redirectTo("/work-os/admin");

  const next = safeWorkOsViewNext(requested, form.get(WORK_OS_VIEW_NEXT_FIELD));
  const response = redirectTo(next);
  response.cookies.set(viewModeCookie(request, requested));
  return response;
}
