import { NextResponse } from "next/server";
import { getAdminOverview } from "@/lib/work-os-admin-overview";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"));
  if ("response" in auth) return auth.response;
  try {
    const date = new URL(req.url).searchParams.get("date");
    return NextResponse.json(await getAdminOverview(auth.access, { date: date ?? undefined }));
  } catch (error) {
    return jsonError(error);
  }
}
