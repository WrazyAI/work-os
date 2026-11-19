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
  } catch {
    return NextResponse.json({ error: "scheduled_activity_recaps_failed" }, { status: 500 });
  }
}
