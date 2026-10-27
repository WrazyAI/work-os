import { NextResponse } from "next/server";
import { checkWorkOsSchemaReady } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ schema: await checkWorkOsSchemaReady() });
  } catch (err) {
    return jsonError(err);
  }
}
