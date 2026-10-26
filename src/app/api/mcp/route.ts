import { NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { agentRouteError, requireAgentAccess } from "@/lib/work-agent-auth";
import { createAgentMcpServer } from "@/lib/work-agent-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A base64 8 MB file is ~10.7 MB plus JSON overhead. The proxy is deliberately
 * excluded for this route; this cap is the replacement body bound. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

function tooLarge() {
  return NextResponse.json({
    jsonrpc: "2.0",
    error: { code: -32600, message: "Request body too large." },
    id: null,
  }, { status: 413 });
}

/** Stateless Streamable HTTP. Each POST gets a fresh server and transport;
 * there is no session map, no second auth path, and no server-initiated SSE. */
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return tooLarge();
  try {
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
  } catch (error) {
    return agentRouteError(error);
  }
}

function methodNotAllowed() {
  return NextResponse.json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  }, { status: 405, headers: { Allow: "POST" } });
}

export function GET() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}
