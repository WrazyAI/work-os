import { NextResponse } from "next/server";
import { getStorageBackend } from "@/lib/db/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";
import {
  COMPLETION_EVIDENCE_BUCKET,
  completionEvidenceDisposition,
  completionEvidenceObjectPath,
  isEmployeeAttachedEvidence,
  normalizeCompletionEvidenceType,
  sanitizeCompletionEvidenceFileName,
  taskEvidenceFromRow,
} from "@/modules/work-os/completion-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authenticated read for one employee-attached completion file. The route
 * parameter keeps its historical `eventId` name because it shares a dynamic
 * segment with the provider-evidence correction route; the value is the
 * `work_evidence` row id. Only explicit employee uploads are served here, so
 * raw Worktivity screenshots keep their own restriction and audit path
 * (design §16.4).
 */
export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
    });
    if (auth.response) return auth.response;
    const { eventId } = await params;
    const { data, error } = await createAdminClient().from("work_evidence")
      .select("id,organization_id,person_id,task_id,source,title,summary,metrics,created_at")
      .eq("organization_id", auth.access.organizationId)
      .eq("id", eventId)
      .maybeSingle();
    if (error) throw new Error(`load completion evidence file: ${error.message}`);
    if (!data || !isEmployeeAttachedEvidence(data as Record<string, unknown>)) {
      return NextResponse.json({ error: "evidence not found" }, { status: 404 });
    }
    if (auth.access.role !== "admin") {
      const personId = typeof data.person_id === "string" ? data.person_id : "";
      if (!personId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
      const denied = await requireWorkOsPersonAccess(auth.access, personId);
      if (denied) return denied;
    }
    const evidence = taskEvidenceFromRow(data as Record<string, unknown>);
    const contentType = normalizeCompletionEvidenceType(evidence.contentType);
    if (!contentType || !data.task_id || !data.person_id) {
      return NextResponse.json({ error: "evidence file is unavailable" }, { status: 404 });
    }
    const objectPath = completionEvidenceObjectPath({
      organizationId: auth.access.organizationId,
      personId: String(data.person_id),
      taskId: String(data.task_id),
      evidenceId: evidence.id,
      contentType,
    });
    const downloaded = await getStorageBackend().download(COMPLETION_EVIDENCE_BUCKET, objectPath);
    if (downloaded.error) {
      if (/does not exist|not found/i.test(downloaded.error.message)) {
        return NextResponse.json({ error: "evidence file not found" }, { status: 404 });
      }
      throw new Error(`load completion evidence file: ${downloaded.error.message}`);
    }
    const fileName = sanitizeCompletionEvidenceFileName(evidence.fileName, contentType);
    // Word documents and archives are downloads. Images, PDFs, and plain text
    // stay inline so the companion can preview them without a second route;
    // HTML and SVG are outside the supported type map entirely.
    const disposition = completionEvidenceDisposition(contentType);
    return new Response(downloaded.data!.arrayBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(downloaded.data!.arrayBuffer.byteLength),
        "Content-Disposition": `${disposition}; filename="${fileName.replaceAll('"', "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(contentType.startsWith("text/") ? { "Content-Security-Policy": "default-src 'none'; sandbox" } : {}),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
