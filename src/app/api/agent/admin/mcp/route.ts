import { NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { createAdminAgentMcpServer } from "@/lib/work-admin-agent-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A base64 8 MB evidence payload is ~10.7 MB plus JSON-RPC overhead. The proxy
 * is deliberately excluded for this route so that payload survives; this cap is
 * the replacement body bound, and it is enforced here before anything is read. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

function requestError(message: string) {
  return NextResponse.json({
    jsonrpc: "2.0",
    error: { code: -32600, message },
    id: null,
  }, { status: 413 });
}

/** The cap only means something when the body size is known up front. A chunked
 * request carries no `content-length`, so reading it to measure would admit an
 * unbounded body first — and the proxy is not buffering this path to stop it.
 * An absent, non-numeric, negative, fractional, or unsafe length is therefore
 * rejected with 413 instead of being streamed; only an explicit decimal
 * `content-length` at or below the cap reaches authentication and the transport. */
function declaredBodyBytes(request: Request): number | null {
  const header = request.headers.get("content-length");
  if (header === null) return null;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const bytes = Number(trimmed);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

/** Stateless Streamable HTTP for the admin surface. Each POST gets a fresh
 * server and transport; there is no session map and no server-initiated SSE.
 * Authoring is the separate REST surface — this endpoint only exposes tools the
 * admin token's scopes already allow. */
export async function POST(request: Request) {
  const declared = declaredBodyBytes(request);
  if (declared === null) return requestError("A valid Content-Length header is required.");
  if (declared > MAX_BODY_BYTES) return requestError("Request body too large.");
  try {
    const auth = await requireAdminAgentAccess(request);
    if (auth.response) return auth.response;
    const server = createAdminAgentMcpServer(auth.agent);
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
    return adminAgentRouteError(error);
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
