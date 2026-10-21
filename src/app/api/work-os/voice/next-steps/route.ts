import { handleNextStepsSpeech } from "@/lib/work-os-next-steps-speech-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/work-os/voice/next-steps — takes a recap id, never text.
export async function POST(request: Request) {
  return handleNextStepsSpeech(request);
}
