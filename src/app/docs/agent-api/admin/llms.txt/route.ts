import { buildAdminAgentInstructions } from "@/modules/work-os/admin-agent-api-llms";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildAdminAgentInstructions(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
