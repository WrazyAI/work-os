import { getWorkOsPublicRequestOrigin } from "@/lib/work-os-release-download";

/** GitHub provider integration for Work OS evidence.
 *
 * The webhook receiver is the ingestion path; this module is the small admin
 * surface that lets an administrator manage the repository hooks from the
 * Evidence page. It needs a fine-grained token with repository Webhooks
 * read/write for the organization; without it the admin UI falls back to
 * manual instructions and everything else keeps working. */

export class GithubIntegrationError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "GithubIntegrationError";
  }
}

export const GITHUB_WEBHOOK_EVENTS = [
  "push",
  "pull_request",
  "pull_request_review",
  "workflow_run",
  "deployment_status",
  "issues",
] as const;

export const GITHUB_WEBHOOK_PATH = "/api/work-os/integrations/github/webhook";

export function githubAdminTokenConfigured() {
  return Boolean(process.env.WORK_OS_GITHUB_ADMIN_TOKEN?.trim());
}

export function githubWebhookUrl(requestUrl: string, headers: Headers) {
  return `${getWorkOsPublicRequestOrigin(requestUrl, headers)}${GITHUB_WEBHOOK_PATH}`;
}

export function githubWebhookSecret() {
  return process.env.WORK_OS_GITHUB_WEBHOOK_SECRET?.trim() ?? "";
}

async function githubApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.WORK_OS_GITHUB_ADMIN_TOKEN?.trim();
  if (!token) throw new GithubIntegrationError("GitHub repository management is not configured for this deployment.", 501);
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message : `GitHub API request failed (${response.status})`;
    throw new GithubIntegrationError(message, response.status === 401 || response.status === 403 ? 403 : 502);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface GithubOrgRepo {
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch: string;
  pushed_at: string | null;
}

/** Lists the organization's repositories, most recently pushed first. */
export async function listGithubOrgRepos(org: string): Promise<GithubOrgRepo[]> {
  const repos = await githubApi<Array<Record<string, unknown>>>(`/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=pushed&direction=desc`);
  return repos
    .filter((repo) => repo.archived !== true)
    .map((repo) => ({
      full_name: String(repo.full_name),
      private: repo.private === true,
      archived: repo.archived === true,
      default_branch: String(repo.default_branch ?? "main"),
      pushed_at: repo.pushed_at ? String(repo.pushed_at) : null,
    }));
}

export async function createGithubRepoHook(input: { org: string; repo: string; secret: string; url: string }): Promise<{ hookId: string; url: string }> {
  const hook = await githubApi<{ id: number; config?: { url?: string } }>(
    `/repos/${encodeURIComponent(input.org)}/${encodeURIComponent(input.repo)}/hooks`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "web",
        active: true,
        events: [...GITHUB_WEBHOOK_EVENTS],
        config: { url: input.url, content_type: "json", secret: input.secret, insecure_ssl: "0" },
      }),
    },
  );
  return { hookId: String(hook.id), url: hook.config?.url ?? input.url };
}

export async function deleteGithubRepoHook(input: { org: string; repo: string; hookId: string }): Promise<void> {
  await githubApi<void>(
    `/repos/${encodeURIComponent(input.org)}/${encodeURIComponent(input.repo)}/hooks/${encodeURIComponent(input.hookId)}`,
    { method: "DELETE" },
  );
}
