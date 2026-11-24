import { NextResponse } from "next/server";
import { runScheduledEodPreparation } from "@/lib/work-os-eod-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bounded scheduler entry point. The platform's systemd timer calls this
 * every five minutes with the same CRON_SECRET as the recap and screenshot
 * jobs. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({})) as { limit?: unknown };
    const limit = Math.min(48, Math.max(1, Number(body.limit) || 24));
    return NextResponse.json(await runScheduledEodPreparation(limit));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "scheduled EOD preparation failed" }, { status: 500 });
  }
}
