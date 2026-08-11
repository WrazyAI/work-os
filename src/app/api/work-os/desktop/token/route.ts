import { NextResponse } from "next/server";
import { exchangeDesktopCode } from "@/lib/work-os-desktop-auth";
import { jsonError } from "@/lib/work-os-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    return NextResponse.json(await exchangeDesktopCode(await req.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error, 401);
  }
}
