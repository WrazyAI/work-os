import { NextResponse } from "next/server";
import { getEmployeeOnboarding, submitEmployeeOnboarding, updateEmployeeConsent } from "@/lib/work-os-onboarding";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function access(req: Request) {
  return requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    authorization: req.headers.get("authorization"),
    requirePerson: true,
    feature: "employee_companion",
  });
}

export async function GET(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    return NextResponse.json(await getEmployeeOnboarding(auth.access));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    return NextResponse.json(await submitEmployeeOnboarding(auth.access, await req.json()));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    return NextResponse.json(await updateEmployeeConsent(auth.access, await req.json()));
  } catch (error) {
    return jsonError(error);
  }
}
