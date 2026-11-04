import { NextResponse } from "next/server";
import { requireWorkOsAccess } from "@/lib/work-os-api";
import { WORK_OS_VIEW_COOKIE } from "@/modules/work-os/view-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

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

/**
 * The public guide's "Open Agent access" destination.
 *
 * It carries a signed-in administrator into their employee workspace before
 * opening Settings, because the token panel lives there. The view cookie is a
 * presentation preference only; every Work OS route still authorizes access.
 */
export async function GET(request: Request) {
  const auth = await requireWorkOsAccess({});
  if (auth.response) {
    if (auth.response.headers.get("x-work-os-workspace-selection") === "required") {
      return redirectTo(`/work-os/select-workspace?next=${encodeURIComponent("/work-os/agent-access")}`);
    }
    if (auth.response.status === 401) {
      return redirectTo(`/login?redirect=${encodeURIComponent("/work-os/agent-access")}`);
    }
    return redirectTo("/work-os/workspace");
  }

  const response = redirectTo("/work-os/settings#agent-access");
  if (auth.access.role === "admin" && auth.access.personId) {
    response.cookies.set({
      name: WORK_OS_VIEW_COOKIE,
      value: "employee",
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      maxAge: ONE_YEAR_SECONDS,
      secure: requestIsSecure(request),
    });
  }
  return response;
}
