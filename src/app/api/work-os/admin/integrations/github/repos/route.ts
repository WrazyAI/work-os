import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  alignGithubRepoHook,
  createGithubRepoHook,
  deleteGithubRepoHook,
  findGithubRepoHook,
  githubAdminTokenConfigured,
  githubWebhookSecret,
  githubWebhookUrl,
  GithubIntegrationError,
  listGithubOrgRepos,
} from "@/lib/integrations/github";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GithubConnectionRepo {
  full_name: string;
  hook_id: string | null;
  created_at: string;
}

function readRepos(config: unknown): GithubConnectionRepo[] {
  const value = (config ?? {}) as Record<string, unknown>;
  return Array.isArray(value.repos) ? (value.repos as GithubConnectionRepo[]) : [];
}

/** True when the organization webhook covers every repository, including new
 * ones; per-repository hooks would then duplicate deliveries. */
function orgWebhookEnabled(config: unknown): boolean {
  return ((config ?? {}) as Record<string, unknown>).org_webhook === true;
}

async function loadGithubConnection(organizationId: string) {
  const { data, error } = await createAdminClient()
    .from("work_provider_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("provider", "github")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`load GitHub connection: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function loadGithubConnectionById(organizationId: string, connectionId: string) {
  const { data, error } = await createAdminClient()
    .from("work_provider_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw new Error(`load GitHub connection: ${error.message}`);
  return data as Record<string, unknown> | null;
}

/** Serializes repository-configuration merges inside this process so two
 * concurrent admin actions cannot lose each other's changes. The web app runs
 * as a single Next.js process and no other process writes provider-connection
 * config, so a process-local queue is the write barrier. */
let repoConfigLock: Promise<unknown> = Promise.resolve();

function withRepoConfigLock<T>(task: () => Promise<T>): Promise<T> {
  const run = repoConfigLock.then(task, task);
  repoConfigLock = run.catch(() => undefined);
  return run;
}

/** Re-reads the same connection by id, verifies it is still active on the same
 * workspace, applies the repository mutation, and saves the merged config. */
async function mergeConnectedRepos(input: {
  organizationId: string;
  connection: Record<string, unknown>;
  mutate: (repos: GithubConnectionRepo[]) => GithubConnectionRepo[];
}): Promise<Record<string, unknown>> {
  return withRepoConfigLock(async () => {
    const fresh = await loadGithubConnectionById(input.organizationId, String(input.connection.id));
    if (!fresh || fresh.active === false || String(fresh.external_workspace_id) !== String(input.connection.external_workspace_id)) {
      throw new GithubIntegrationError("The GitHub connection changed while saving; refresh the page and retry.", 409);
    }
    const repos = input.mutate(readRepos(fresh.config));
    const { data, error } = await createAdminClient()
      .from("work_provider_connections")
      .update({ config: { ...(fresh.config as Record<string, unknown> ?? {}), repos }, updated_at: new Date().toISOString() })
      .eq("id", fresh.id)
      .eq("organization_id", input.organizationId)
      .select("*")
      .single();
    if (error) throw new Error(`save GitHub repository configuration: ${error.message}`);
    return data as Record<string, unknown>;
  });
}

/** Repository management for the GitHub evidence integration. The
 * organization comes from the active GitHub provider connection; the token
 * (WORK_OS_GITHUB_ADMIN_TOKEN) is optional and the UI degrades to manual
 * instructions without it. */
export async function GET(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const connection = await loadGithubConnection(auth.access.organizationId);
    const organization = connection ? String(connection.external_workspace_id) : null;
    const connectedRepos = readRepos(connection?.config);
    const webhookUrl = githubWebhookUrl(req.url, req.headers);
    if (!connection || !organization) {
      return NextResponse.json({
        connection: null,
        organization: null,
        repos: [],
        connectedRepos,
        webhookUrl,
        configuration: { repositoryManagementReady: githubAdminTokenConfigured(), webhookReceiverReady: Boolean(githubWebhookSecret()) },
      });
    }
    const manageable = githubAdminTokenConfigured() && !/^[0-9]+$/.test(organization);
    const repos = manageable ? await listGithubOrgRepos(organization) : [];
    return NextResponse.json({
      connection: { id: connection.id, workspace: organization },
      organization,
      repos,
      connectedRepos,
      webhookUrl,
      configuration: {
        repositoryManagementReady: manageable,
        webhookReceiverReady: Boolean(githubWebhookSecret()),
        orgWebhook: orgWebhookEnabled(connection.config),
        reason: !githubAdminTokenConfigured()
          ? "No GitHub repository-management token is configured for this deployment."
          : /^[0-9]+$/.test(organization)
            ? "The GitHub connection uses a numeric workspace id; connect with the organization login to manage repositories."
            : null,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const secret = githubWebhookSecret();
    if (!secret) return NextResponse.json({ error: "GitHub webhook secret is not configured for this deployment" }, { status: 503 });
    const connection = await loadGithubConnection(auth.access.organizationId);
    if (!connection) return NextResponse.json({ error: "Connect the GitHub workspace in Settings before adding repositories." }, { status: 409 });
    if (orgWebhookEnabled(connection.config)) {
      return NextResponse.json(
        { error: "The organization webhook already covers every repository, including new ones; a per-repository hook would duplicate deliveries." },
        { status: 409 },
      );
    }
    const organization = String(connection.external_workspace_id);
    const body = await req.json().catch(() => ({}));
    const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
    if (!repo || !repo.toLowerCase().startsWith(`${organization.toLowerCase()}/`)) {
      return NextResponse.json({ error: `Repository must belong to the connected workspace (${organization}).` }, { status: 400 });
    }
    const name = repo.slice(organization.length + 1);
    const existingRepos = readRepos(connection.config);
    if (existingRepos.some((entry) => entry.full_name.toLowerCase() === repo.toLowerCase())) {
      return NextResponse.json({ error: "That repository already has a Work OS webhook.", connectedRepos: existingRepos }, { status: 409 });
    }
    const webhookUrl = githubWebhookUrl(req.url, req.headers);
    // Adopt a hook that already points at this receiver (created manually or
    // before the app knew the repository) and align it with this deployment's
    // secret and event list instead of creating a duplicate.
    const existingHook = await findGithubRepoHook({ org: organization, repo: name, url: webhookUrl });
    const adopted = Boolean(existingHook);
    const result = existingHook
      ? await alignGithubRepoHook({ org: organization, repo: name, hookId: existingHook.hookId, secret, url: webhookUrl })
      : await createGithubRepoHook({ org: organization, repo: name, secret, url: webhookUrl });
    let data: Record<string, unknown>;
    try {
      data = await mergeConnectedRepos({
        organizationId: auth.access.organizationId,
        connection,
        mutate: (repos) => [
          ...repos.filter((entry) => entry.full_name.toLowerCase() !== repo.toLowerCase()),
          { full_name: repo, hook_id: result.hookId, created_at: new Date().toISOString() },
        ],
      });
    } catch (mergeError) {
      // Never leave a hook behind when its connection record could not be
      // updated; a retry must start clean. An adopted hook existed before this
      // action, so it is left in place.
      if (!adopted) {
        try {
          await deleteGithubRepoHook({ org: organization, repo: name, hookId: result.hookId });
        } catch {
          // Best effort: the admin can remove a stray hook in GitHub.
        }
      }
      throw mergeError;
    }
    const db = createAdminClient();
    await db.from("work_audit_log").insert({
      organization_id: auth.access.organizationId,
      actor_user_id: auth.access.ctx.user.id,
      action: adopted ? "github.repo_hook_adopted" : "github.repo_hook_created",
      target_type: "provider_connection",
      target_id: connection.id,
      metadata: { repo, hookId: result.hookId },
    });
    return NextResponse.json({ connection: data, connectedRepos: readRepos(data.config), adopted }, { status: 201 });
  } catch (error) {
    if (error instanceof GithubIntegrationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}

export async function DELETE(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const repo = new URL(req.url).searchParams.get("repo")?.trim() ?? "";
    if (!repo) return NextResponse.json({ error: "repo is required" }, { status: 400 });
    const connection = await loadGithubConnection(auth.access.organizationId);
    if (!connection) return NextResponse.json({ error: "GitHub is not connected." }, { status: 409 });
    const organization = String(connection.external_workspace_id);
    const repos = readRepos(connection.config);
    const entry = repos.find((item) => item.full_name.toLowerCase() === repo.toLowerCase());
    if (!entry) return NextResponse.json({ error: "That repository is not connected through Work OS." }, { status: 404 });
    if (entry.hook_id) {
      try {
        await deleteGithubRepoHook({ org: organization, repo: repo.slice(organization.length + 1), hookId: entry.hook_id });
      } catch (error) {
        // A hook already removed on GitHub still gets removed from Work OS.
        if (!(error instanceof GithubIntegrationError) || error.status !== 404) throw error;
      }
    }
    const data = await mergeConnectedRepos({
      organizationId: auth.access.organizationId,
      connection,
      mutate: (current) => current.filter((item) => item.full_name.toLowerCase() !== repo.toLowerCase()),
    });
    const db = createAdminClient();
    await db.from("work_audit_log").insert({
      organization_id: auth.access.organizationId,
      actor_user_id: auth.access.ctx.user.id,
      action: "github.repo_hook_removed",
      target_type: "provider_connection",
      target_id: connection.id,
      metadata: { repo, hookId: entry.hook_id },
    });
    return NextResponse.json({ connection: data, connectedRepos: readRepos(data.config) });
  } catch (error) {
    if (error instanceof GithubIntegrationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
