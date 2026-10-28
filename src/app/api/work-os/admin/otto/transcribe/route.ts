import { handleAdminOttoTranscribe } from "@/lib/work-os-admin-otto-speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/work-os/admin/otto/transcribe — admin+voice authorization without a
// personal employee mapping. Reuses the employee upload/size/type guards and
// failure copy; the clip is forwarded and dropped, never persisted.
export async function POST(request: Request) {
  return handleAdminOttoTranscribe(request);
}
