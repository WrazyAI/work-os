import { NextResponse } from "next/server";
import { syncDueWorktivityAttendance } from "@/lib/work-os-attendance";
import { flushTimebotOutbox } from "@/lib/work-os-cosmos-timebot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(12, Math.max(1, Number(body.limit) || 8));
    const result = await syncDueWorktivityAttendance(limit);
    // The sync is what turns a Worktivity interval into work_session_events, so
    // this is the earliest moment the #timebot message can go out. A failure
    // here must never change the sync response.
    let timebot: unknown;
    try {
      timebot = await flushTimebotOutbox(20);
    } catch (notificationError) {
      timebot = { error: notificationError instanceof Error ? notificationError.message : "timebot flush failed" };
    }
    return NextResponse.json({ ...result, timebot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Worktivity attendance sync failed" }, { status: 500 });
  }
}

