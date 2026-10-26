import { NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { requireAgentAccess } from "@/lib/work-agent-auth";
import { createAgentMcpServer } from "@/lib/work-agent-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stateless Streamable HTTP. Each POST gets a fresh server and transport;
 * there is no session map, no second auth path, and no server-initiated SSE. */
export async function POST(request: Request) {
  const auth = await requireAgentAccess(request);
  if (auth.response) return auth.response;
  const server = createAgentMcpServer(auth.agent);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

function methodNotAllowed() {
  return NextResponse.json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  }, { status: 405 });
}

export function GET() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}
