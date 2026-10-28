import { handleAdminRecapSpeech } from "@/lib/work-os-admin-otto-speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/work-os/admin/otto/recaps/:intervalId/speech — the body carries a
// reviewed version key and voice, never arbitrary text. The handler owns the
// admin+voice authorization, immutable-version check, cache/quota path and the
// post-synthesis reauthorization.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ intervalId: string }> },
) {
  const { intervalId } = await params;
  return handleAdminRecapSpeech(request, intervalId);
}
