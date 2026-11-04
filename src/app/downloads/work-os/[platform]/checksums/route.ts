import { publicInstallerPlatform } from "@/lib/work-os-installers";
import { downloadPublicChecksums, installerError } from "@/lib/work-os-installer-downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (publicInstallerPlatform(platform) === null) {
    return Response.json({ error: "No checksums are published for this platform." }, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    const response = await downloadPublicChecksums(platform);
    return response ?? Response.json({ error: "No checksums are published for this platform." }, { status: 404 });
  } catch (error) {
    return installerError(error);
  }
}
