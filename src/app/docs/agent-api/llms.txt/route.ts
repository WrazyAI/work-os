import { buildAgentInstructions } from "@/modules/work-os/agent-api-llms";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildAgentInstructions(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
