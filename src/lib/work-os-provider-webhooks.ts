import { createHmac, timingSafeEqual, verify } from "node:crypto";

export type WorkOsWebhookJson = Record<string, any>;

export interface WorkOsEvidenceActor {
  id?: string | null;
  login?: string | null;
}

export interface GithubEvidenceObservation {
  title: string;
  summary: string;
  artifactUrl?: string | null;
  occurredAt?: string | null;
  /** The person the evidence belongs to: the commit author, PR author, or the
   * acting sender, depending on what the event establishes. */
  actor?: WorkOsEvidenceActor | null;
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

function actorFrom(value: WorkOsWebhookJson | null | undefined): WorkOsEvidenceActor | null {
  if (!value) return null;
  const id = value.id != null ? String(value.id) : null;
  // Commit authors expose `username`; user objects expose `login`.
  const rawLogin = typeof value.login === "string" ? value.login : typeof value.username === "string" ? value.username : null;
  const login = rawLogin && rawLogin.trim() ? rawLogin.trim() : null;
  if (!id && !login) return null;
  return { id, login };
}

function shortSha(value: unknown) {
  const sha = String(value ?? "");
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : null;
}

/** Turns one GitHub webhook delivery into one evidence observation, or null
 * when the event is not evidence for a developer's record. Noise is trimmed
 * deliberately: pull requests only on open/close, reviews only when
 * submitted, issues only on open/close, workflow runs only when completed,
 * and pushes only to the repository's default branch. */
export function githubObservation(event: string, payload: WorkOsWebhookJson): GithubEvidenceObservation | null {
  const action = String(payload.action ?? "event");
  const sender = actorFrom(payload.sender);
  if (event === "push") {
    const repository = payload.repository ?? {};
    const defaultBranch = String(repository.default_branch ?? "main");
    if (payload.deleted === true || payload.ref !== `refs/heads/${defaultBranch}`) return null;
    const commits: WorkOsWebhookJson[] = Array.isArray(payload.commits) ? payload.commits : [];
    const count = Number(payload.size ?? commits.length) || commits.length;
    if (!count) return null;
    const lines = commits
      .slice(0, 10)
      .map((commit) => {
        const subject = String(commit.message ?? "").split("\n")[0].trim();
        const sha = shortSha(commit.id);
        return subject ? `${sha ? `${sha} ` : ""}${subject}` : null;
      })
      .filter((line): line is string => !!line);
    const more = commits.length > lines.length ? ` (+${commits.length - lines.length} more)` : "";
    const author = actorFrom(payload.head_commit?.author);
    return {
      title: `Pushed ${count} commit${count === 1 ? "" : "s"} to ${defaultBranch}`,
      summary: `Pushed ${count} commit${count === 1 ? "" : "s"} to ${repository.full_name ?? "the repository"} (${defaultBranch}): ${lines.join("; ") || "no commit subjects recorded"}${more}`,
      artifactUrl: payload.compare ?? payload.head_commit?.html_url ?? null,
      occurredAt: payload.head_commit?.timestamp || payload.repository?.pushed_at || new Date().toISOString(),
      actor: author ?? sender,
    };
  }
  if (event === "pull_request") {
    if (!["opened", "closed", "reopened"].includes(action)) return null;
    const pull = payload.pull_request ?? {};
    const merged = action === "closed" && pull.merged === true;
    const state = action === "closed" ? (merged ? "merged" : "closed without merging") : action;
    return {
      title: merged ? `Pull request merged: ${pull.title}` : `Pull request ${state}: ${pull.title}`,
      summary: `GitHub pull request #${pull.number ?? payload.number} was ${state} in ${payload.repository?.full_name ?? "the repository"}.`,
      artifactUrl: pull.html_url,
      occurredAt: pull.merged_at || pull.closed_at || pull.updated_at || pull.created_at,
      actor: actorFrom(pull.user) ?? sender,
    };
  }
  if (event === "pull_request_review") {
    if (action !== "submitted") return null;
    const review = payload.review ?? {};
    const state = String(review.state ?? "commented").replaceAll("_", " ");
    const pull = payload.pull_request ?? {};
    return {
      title: `Pull request review ${state}: ${pull.title ?? `#${pull.number ?? "unknown"}`}`,
      summary: `A GitHub review was submitted (${state}) on pull request #${pull.number ?? "unknown"} in ${payload.repository?.full_name ?? "the repository"}.`,
      artifactUrl: review.html_url || pull.html_url,
      occurredAt: review.submitted_at,
      actor: sender,
    };
  }
  if (event === "workflow_run") {
    if (action !== "completed") return null;
    const run = payload.workflow_run ?? {};
    const conclusion = String(run.conclusion ?? "unknown");
    return {
      title: `Workflow ${conclusion}: ${run.name ?? "GitHub Actions"}`,
      summary: `GitHub workflow run ${run.id ?? ""} finished with conclusion ${conclusion} on ${run.head_branch ?? "a branch"} in ${payload.repository?.full_name ?? "the repository"}.`,
      artifactUrl: run.html_url,
      occurredAt: run.updated_at || run.created_at,
      actor: sender,
    };
  }
  if (event === "deployment_status") {
    const status = payload.deployment_status ?? {};
    return {
      title: `Deployment status: ${status.state ?? "updated"}`,
      summary: `GitHub deployment ${payload.deployment?.id ?? ""} changed to ${status.state ?? "unknown"} in ${payload.repository?.full_name ?? "the repository"}.`,
      artifactUrl: status.target_url || status.environment_url,
      occurredAt: status.created_at || status.updated_at,
      actor: sender,
    };
  }
  if (event === "issues") {
    if (!["opened", "closed", "reopened"].includes(action)) return null;
    const issue = payload.issue ?? {};
    return {
      title: `Issue ${action}: ${issue.title ?? "GitHub issue"}`,
      summary: `GitHub issue #${issue.number ?? ""} was ${action} in ${payload.repository?.full_name ?? "the repository"}.`,
      artifactUrl: issue.html_url,
      occurredAt: issue.closed_at || issue.updated_at || issue.created_at,
      actor: sender,
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
