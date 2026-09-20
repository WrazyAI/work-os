import { NextResponse } from "next/server";
import { getEmployeeOnboarding } from "@/lib/work-os-onboarding";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { updateWorkOsProfile, type WorkOsProfileUpdate } from "@/lib/work-os-profile";

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

async function parseUpdate(req: Request): Promise<WorkOsProfileUpdate> {
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    const settingsValue = form.get("settings");
    let settings: Record<string, unknown> = {};
    if (typeof settingsValue === "string" && settingsValue.trim()) {
      const parsed = JSON.parse(settingsValue);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("profile settings must be an object");
      settings = parsed as Record<string, unknown>;
    }
    const avatar = form.get("avatar");
    return {
      settings,
      displayName: settings.displayName,
      removeAvatar: form.get("removeAvatar") === "true",
      avatarBytes: avatar instanceof File ? new Uint8Array(await avatar.arrayBuffer()) : undefined,
      avatarContentType: avatar instanceof File ? avatar.type : undefined,
    };
  }

  const body = await req.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("profile settings must be an object");
  const settings = body as Record<string, unknown>;
  return { settings, displayName: settings.displayName, removeAvatar: settings.removeAvatar === true };
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

export async function PATCH(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    return NextResponse.json(await updateWorkOsProfile(auth.access, await parseUpdate(req)));
  } catch (error) {
    return jsonError(error);
  }
}
