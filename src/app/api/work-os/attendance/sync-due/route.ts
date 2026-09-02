import { NextResponse } from "next/server";
import { syncDueWorktivityAttendance } from "@/lib/work-os-attendance";

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
    return NextResponse.json(await syncDueWorktivityAttendance(limit));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Worktivity attendance sync failed" }, { status: 500 });
  }
}
