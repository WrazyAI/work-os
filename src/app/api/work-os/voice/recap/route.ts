import { NextResponse } from "next/server";
import { handleRecapSpeech } from "@/lib/work-os-recap-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/work-os/voice/recap — takes a recap id, never arbitrary text, and
// answers with the spoken clip for that recap's own lines.
export async function POST(request: Request) {
  return handleRecapSpeech(request);
}
