import { NextResponse } from "next/server";
import { runScheduledEodPreparation } from "@/lib/work-os-eod-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Employee-due-time dispatcher. The platform timer calls this every minute;
 * each employee is prepared around ten minutes before their own scheduled
 * clock-out. A small fallback scan runs on the quarter hour so a missed tick,
 * a flexible day, or a plan-only day is still prepared before the employee
 * opens the composer. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({})) as { limit?: unknown };
    const limit = Math.min(48, Math.max(1, Number(body.limit) || 36));
    const at = new Date();
    const due = await runScheduledEodPreparation(limit, at, "due");
    const fallback = at.getUTCMinutes() % 15 === 0
      ? await runScheduledEodPreparation(Math.min(8, limit), at, "fallback")
      : null;
    return NextResponse.json(fallback ? { due, fallback } : { due });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "scheduled EOD preparation failed" }, { status: 500 });
  }
}
