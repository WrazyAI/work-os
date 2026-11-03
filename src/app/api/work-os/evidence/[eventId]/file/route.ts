import { NextResponse } from "next/server";
import { getStorageBackend } from "@/lib/db/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminEvidenceObjectPath } from "@/lib/work-admin-agent-evidence";
import { getWorkOsEmployeeTaskDetails } from "@/lib/work-os-employee-tasks";
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
 * Authenticated read for one completion file. The route parameter keeps its
 * historical `eventId` name because it shares a dynamic segment with the
 * provider-evidence correction route; the value is the `work_evidence` row id.
 * Only explicit completion uploads are served here, so raw Worktivity
 * screenshots keep their own restriction and audit path (design §16.4).
 *
 * Two scopes are served:
 * - an employee-attached file (`person_id` set) keeps its original person
 *   authorization and person-segmented object path;
 * - an admin-agent file (`person_id` null, `task_id` set) is task-scoped, so an
 *   organization admin or a person with access to that task may open it from
 *   the task-based object path. Without this branch the row would satisfy the
 *   completion gate but no in-product session could ever open the file.
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
    const evidence = taskEvidenceFromRow(data as Record<string, unknown>);
    const contentType = normalizeCompletionEvidenceType(evidence.contentType);
    const personId = typeof data.person_id === "string" && data.person_id ? data.person_id : null;
    const taskId = typeof data.task_id === "string" && data.task_id ? data.task_id : null;
    if (!contentType || !taskId) {
      return NextResponse.json({ error: "evidence file is unavailable" }, { status: 404 });
    }

    let objectPath: string;
    if (personId) {
      // The employee path is unchanged: a person's file stays under that person.
      if (auth.access.role !== "admin") {
        const denied = await requireWorkOsPersonAccess(auth.access, personId);
        if (denied) return denied;
      }
      objectPath = completionEvidenceObjectPath({
        organizationId: auth.access.organizationId,
        personId,
        taskId,
        evidenceId: evidence.id,
        contentType,
      });
    } else {
      // A task-scoped admin attachment has no person to match. An admin can
      // open any task file in the organization; anyone else must be able to
      // read the task itself, which the employee detail reader already proves
      // (it answers 404 for another person's or another tenant's task).
      if (auth.access.role !== "admin") {
        if (!auth.access.personId) {
          return NextResponse.json({ error: "evidence not found" }, { status: 404 });
        }
        await getWorkOsEmployeeTaskDetails(auth.access, taskId);
      }
      objectPath = adminEvidenceObjectPath({
        organizationId: auth.access.organizationId,
        taskId,
        evidenceId: evidence.id,
        contentType,
      });
    }
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
