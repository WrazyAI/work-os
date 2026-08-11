import { createHmac, timingSafeEqual, verify } from "node:crypto";

export type WorkOsWebhookJson = Record<string, any>;

export interface GithubEvidenceObservation {
  title: string;
  summary: string;
  artifactUrl?: string | null;
  occurredAt?: string | null;
}

export const DEFAULT_GHL_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

export function isValidGithubWebhookSignature(raw: string, signature: string | null, secret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function linkedNiftyTask(payload: WorkOsWebhookJson) {
  const text = [payload.pull_request?.title, payload.pull_request?.body, payload.issue?.title, payload.issue?.body, payload.deployment?.description]
    .filter(Boolean).join("\n");
  const urlMatch = text.match(/nifty\.pm\/[^\s)]+\/(?:task|tasks)\/([A-Za-z0-9_-]+)/i);
  if (urlMatch) return urlMatch[1];
  return text.match(/\bnifty(?:\s+task)?\s*[:#/-]\s*([A-Za-z0-9_-]{6,})\b/i)?.[1] ?? null;
}

export function githubObservation(event: string, payload: WorkOsWebhookJson): GithubEvidenceObservation | null {
  const action = String(payload.action ?? "event");
  if (event === "pull_request") {
    const pull = payload.pull_request ?? {};
    const merged = action === "closed" && pull.merged === true;
    return {
      title: merged ? `Pull request merged: ${pull.title}` : `Pull request ${action}: ${pull.title}`,
      summary: `GitHub pull request #${pull.number ?? payload.number} was ${merged ? "merged" : action}.`,
      artifactUrl: pull.html_url,
      occurredAt: pull.merged_at || pull.updated_at || pull.created_at,
    };
  }
  if (event === "pull_request_review") {
    const review = payload.review ?? {};
    return {
      title: `Pull request review ${action}`,
      summary: `A GitHub review was ${action} on pull request #${payload.pull_request?.number ?? "unknown"}.`,
      artifactUrl: review.html_url || payload.pull_request?.html_url,
      occurredAt: review.submitted_at,
    };
  }
  if (event === "workflow_run") {
    const run = payload.workflow_run ?? {};
    return {
      title: `Workflow ${action}: ${run.name ?? "GitHub Actions"}`,
      summary: `GitHub workflow run ${run.id ?? ""} finished with conclusion ${run.conclusion ?? "unknown"}.`,
      artifactUrl: run.html_url,
      occurredAt: run.updated_at || run.created_at,
    };
  }
  if (event === "deployment_status") {
    const status = payload.deployment_status ?? {};
    return {
      title: `Deployment status: ${status.state ?? "updated"}`,
      summary: `GitHub deployment ${payload.deployment?.id ?? ""} changed to ${status.state ?? "unknown"}.`,
      artifactUrl: status.target_url || status.environment_url,
      occurredAt: status.created_at || status.updated_at,
    };
  }
  if (event === "issues") {
    const issue = payload.issue ?? {};
    return {
      title: `Issue ${action}: ${issue.title ?? "GitHub issue"}`,
      summary: `GitHub issue #${issue.number ?? ""} was ${action}.`,
      artifactUrl: issue.html_url,
      occurredAt: issue.closed_at || issue.updated_at || issue.created_at,
    };
  }
  return null;
}

export function isValidGhlWebhookSignature(raw: string, signature: string | null, publicKey?: string) {
  if (!signature) return false;
  const key = publicKey || process.env.WORK_OS_GHL_WEBHOOK_PUBLIC_KEY || DEFAULT_GHL_PUBLIC_KEY;
  try {
    return verify(null, Buffer.from(raw, "utf8"), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export function label(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

export function isEmployeeOutput(type: string) {
  return /outbound|appointment|taskcomplete|notecreate|opportunity|call.*(complete|end)|conversation.*update/i.test(type);
}
