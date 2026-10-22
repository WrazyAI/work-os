import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The repository contract is the source of truth; this route only serves it. */
export async function GET() {
  const body = await readFile(path.join(process.cwd(), "docs/openapi/work-os-agent-v1.yaml"), "utf8");
  return new Response(body, {
    headers: {
      "content-type": "application/yaml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
