import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ target: string; arch: string; version: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      authorization: req.headers.get("authorization"),
      organizationId: req.headers.get("x-work-os-organization-id"),
      feature: "desktop_companion",
    });
    if (auth.response) return auth.response;
    const template = process.env.WORK_OS_DESKTOP_UPDATE_MANIFEST_URL?.trim();
    if (!template) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    const values = await params;
    const manifestUrl = template
      .replaceAll("{{target}}", encodeURIComponent(values.target))
      .replaceAll("{{arch}}", encodeURIComponent(values.arch))
      .replaceAll("{{current_version}}", encodeURIComponent(values.version));
    const upstream = await fetch(manifestUrl, { cache: "no-store" });
    if (upstream.status === 204 || upstream.status === 404) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    if (!upstream.ok) throw new Error(`desktop update feed failed (${upstream.status})`);
    const manifest = await upstream.text();
    JSON.parse(manifest);
    return new NextResponse(manifest, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
