import { NextResponse } from "next/server";
import { flushTimebotOutbox } from "@/lib/work-os-cosmos-timebot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Scheduled drain and retry for the Cosmos #timebot queue. The attendance sync
 * flushes inline for immediacy; this route is the safety net when the inline
 * send failed, the process restarted, or Cosmos was briefly unavailable. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(50, Math.max(1, Number(body.limit) || 20));
    return NextResponse.json(await flushTimebotOutbox(limit));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cosmos timebot dispatch failed" },
      { status: 500 },
    );
  }
}
