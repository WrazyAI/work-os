import { NextResponse } from "next/server";
import { payrollError, requirePayrollAdmin } from "@/lib/work-os-payroll-api";
import { answerPayrollQuestion, listPayrollQuestions } from "@/lib/work-os-payroll-questions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ reviewId: string }> }) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const { reviewId } = await context.params;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.question !== "string" || typeof body.requestKey !== "string") return NextResponse.json({ error: "question and requestKey are required" }, { status: 400 });
    return NextResponse.json(await answerPayrollQuestion(auth.access, reviewId, {
      threadId: typeof body.threadId === "string" ? body.threadId : "",
      token: { rowVersion: String(body.rowVersion ?? ""), analysisRevision: Number(body.analysisRevision), sourceHash: String(body.sourceHash ?? "") },
      approvalId: typeof body.approvalId === "string" ? body.approvalId : null,
      question: body.question, requestKey: body.requestKey,
    }));
  } catch (error) { return payrollError(error); }
}

export async function GET(req: Request, context: { params: Promise<{ reviewId: string }> }) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const { reviewId } = await context.params;
    const url = new URL(req.url);
    const threadId = url.searchParams.get("threadId") ?? "";
    if (!threadId) return NextResponse.json({ error: "threadId is required" }, { status: 400 });
    return NextResponse.json(await listPayrollQuestions(auth.access, reviewId, { threadId, cursor: null, limit: 20 }));
  } catch (error) { return payrollError(error); }
}
