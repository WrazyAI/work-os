import { NextResponse } from "next/server";
import { attachWorkOsTaskCompletionEvidence, setWorkOsEmployeeTaskCompletion } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { CompletionEvidenceError, COMPLETION_EVIDENCE_MAX_BYTES } from "@/modules/work-os/completion-evidence";

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

/**
 * One employee-attached completion file plus an optional note. The evidence
 * row and storage object are persisted before the completion mutation runs;
 * a completion failure answers with the saved evidence so the client can
 * retry only the completion instead of uploading the file twice.
 */
export async function POST(req: Request, context: { params: Promise<{ taskId: string }> }) {
  let auth: Awaited<ReturnType<typeof access>>;
  try {
    auth = await access(req);
  } catch (error) {
    return jsonError(error);
  }
  if (auth.response) return auth.response;

  const { taskId } = await context.params;
  try {
    const form = await req.formData();
    const files = form.getAll("file").filter((value): value is File => typeof value !== "string");
    if (files.length !== 1) return NextResponse.json({ error: "Attach exactly one completion evidence file" }, { status: 400 });
    const file = files[0]!;
    if (file.size <= 0) return NextResponse.json({ error: "The evidence file must not be empty" }, { status: 400 });
    if (file.size > COMPLETION_EVIDENCE_MAX_BYTES) {
      return NextResponse.json({ error: "The evidence file must be 8 MB or smaller" }, { status: 400 });
    }
    const idempotencyKey = String(form.get("idempotency_key") ?? req.headers.get("idempotency-key") ?? "").trim();
    if (!idempotencyKey) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });
    const note = form.get("note");
    const complete = form.get("complete") !== "false";
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) {
      return NextResponse.json({ error: "The evidence file could not be read completely" }, { status: 400 });
    }
    const attached = await attachWorkOsTaskCompletionEvidence(auth.access, taskId, {
      fileName: file.name,
      contentType: file.type,
      bytes,
      note: typeof note === "string" ? note : "",
      idempotencyKey,
    });
    if (!complete) return NextResponse.json({ evidence: attached.evidence, task: null }, { status: 201 });

    try {
      const completed = await setWorkOsEmployeeTaskCompletion(auth.access, taskId, true);
      return NextResponse.json({
        evidence: attached.evidence,
        task: completed.task,
        providerStatus: completed.providerStatus,
      }, { status: 201 });
    } catch (completionError) {
      const message = completionError instanceof Error ? completionError.message : "The task could not be marked complete";
      return NextResponse.json({
        error: `Evidence saved. ${message}`,
        evidence: attached.evidence,
        task: null,
        completion: "failed",
      }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof CompletionEvidenceError) return NextResponse.json({ error: error.message }, { status: 400 });
    return jsonError(error, 502);
  }
}
