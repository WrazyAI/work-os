import { AGENT_API_LLMS_PATH } from "@/modules/work-os/agent-api-docs";

export function GET() {
  // Keep the client's origin: the deployment proxy forwards to a loopback server.
  return new Response(null, { status: 308, headers: { location: AGENT_API_LLMS_PATH } });
}
