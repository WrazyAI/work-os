import { NextResponse } from "next/server";
import { authorizeDesktop } from "@/lib/work-os-desktop-auth";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { hasExpectedPublicOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    if (!hasExpectedPublicOrigin(req)) {
      return NextResponse.json({ error: "invalid origin" }, { status: 403 });
    }
    const auth = await requireWorkOsAccess({ requirePerson: true, feature: "desktop_companion" });
    if (auth.response) return auth.response;
    return NextResponse.json(await authorizeDesktop(auth.access, await req.json()));
  } catch (error) {
    return jsonError(error);
  }
}
