import { NextResponse } from "next/server";
import { deleteExpiredWorkOsScreenshots } from "@/lib/work-os-screenshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await deleteExpiredWorkOsScreenshots());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "screenshot retention failed" }, { status: 500 });
  }
}
