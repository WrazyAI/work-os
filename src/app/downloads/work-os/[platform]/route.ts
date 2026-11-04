import { NextResponse } from "next/server";
import { publicInstallerPlatform } from "@/lib/work-os-installers";
import { downloadPublicInstaller, installerError } from "@/lib/work-os-installer-downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform: raw } = await params;
  const platform = publicInstallerPlatform(raw);
  if (!platform) {
    return NextResponse.json(
      { error: "A Linux version is not available yet." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    return await downloadPublicInstaller(platform);
  } catch (error) {
    return installerError(error);
  }
}

export async function HEAD(request: Request, context: { params: Promise<{ platform: string }> }) {
  const response = await GET(request, context);
  return new Response(null, { status: response.status, headers: response.headers });
}
