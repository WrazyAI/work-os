import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { getStorageBackend } from "@/lib/db/storage";
import { profileAvatarObjectPath, PROFILE_AVATAR_BUCKET, updateWorkOsProfile } from "@/lib/work-os-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function access(req: Request) {
  return requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    authorization: req.headers.get("authorization"),
    requirePerson: true,
    feature: "employee_companion",
  });
}

export async function GET(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const result = await getStorageBackend().download(PROFILE_AVATAR_BUCKET, profileAvatarObjectPath(auth.access.ctx.user.id));
    if (result.error) {
      if (/does not exist|not found/i.test(result.error.message)) return NextResponse.json({ error: "avatar not found" }, { status: 404 });
      throw new Error(`load profile avatar: ${result.error.message}`);
    }
    return new Response(result.data!.arrayBuffer, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    return NextResponse.json(await updateWorkOsProfile(auth.access, { removeAvatar: true }));
  } catch (error) {
    return jsonError(error);
  }
}
