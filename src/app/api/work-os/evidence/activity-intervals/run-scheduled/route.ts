import { NextResponse } from "next/server";
import { runScheduledActivityRecaps } from "@/lib/work-os-activity-recap-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(48, Math.max(1, Number(body.limit) || 24));
    return NextResponse.json(await runScheduledActivityRecaps(limit));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "scheduled activity recaps failed" }, { status: 500 });
  }
}
