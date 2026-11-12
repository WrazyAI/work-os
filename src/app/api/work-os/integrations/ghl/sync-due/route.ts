import { NextResponse } from "next/server";
import { syncDueGhlEvidence } from "@/lib/work-os-ghl-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(20, Math.max(1, Number(body.limit) || 5));
    return NextResponse.json(await syncDueGhlEvidence({ now: new Date(), limit }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GHL sync failed" }, { status: 500 });
  }
}
