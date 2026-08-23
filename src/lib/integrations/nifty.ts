import { AsyncLocalStorage } from "node:async_hooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptProviderSecret, encryptProviderSecret } from "@/lib/work-os-secrets";

const DEFAULT_BASE = "https://openapi.niftypm.com";

export interface NiftyConfigStatus {
  apiBase: string;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasAuthorizeUrl: boolean;
  hasRedirectUri: boolean;
  canCallApi: boolean;
  canStartOAuth: boolean;
  redirectUri: string | null;
}

export interface NiftyListParams {
  limit?: string;
  offset?: string;
  [key: string]: string | string[] | undefined;
}

export interface NiftyProjectSummary {
  id: string;
  name: string;
  archived?: boolean;
  raw: Record<string, unknown>;
}

export interface NiftyMemberSummary {
  id: string;
  name: string;
  email?: string | null;
  raw: Record<string, unknown>;
}

export interface NiftyTaskSummary {
  id: string;
  name: string;
  projectId?: string | null;
  taskGroupId?: string | null;
  milestoneId?: string | null;
  status?: string | null;
  completed?: boolean | null;
  assignees: string[];
  dueDate?: string | null;
  startDate?: string | null;
  completedAt?: string | null;
  description?: string | null;
  priority?: string | null;
  labels: string[];
  storyPoints?: number | null;
  dependencyIds: string[];
  parentTaskId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  raw: Record<string, unknown>;
}

export interface NiftyTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

type CachedToken = { accessToken: string; refreshToken?: string; expiresAt: number };
const organizationContext = new AsyncLocalStorage<string>();
const organizationTokens = new Map<string, CachedToken>();
let legacyToken: CachedToken | null = null;

export function withNiftyOrganization<T>(organizationId: string, operation: () => Promise<T>) {
  return organizationContext.run(organizationId, operation);
}

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function niftyApiBase(): string {
  return env("NIFTY_API_BASE") ?? DEFAULT_BASE;
}

export function niftyRedirectUri(): string | undefined {
  return env("NIFTY_REDIRECT_URI") ?? env("NIFTY_REDIRECT_URL");
}

export function niftyConfigStatus(): NiftyConfigStatus {
  const hasAccessToken = !!env("NIFTY_ACCESS_TOKEN");
  const hasRefreshToken = !!env("NIFTY_REFRESH_TOKEN");
  const hasClientId = !!env("NIFTY_CLIENT_ID");
  const hasClientSecret = !!env("NIFTY_CLIENT_SECRET");
  const hasAuthorizeUrl = !!env("NIFTY_AUTHORIZE_URL");
  const redirectUri = niftyRedirectUri() ?? null;

  return {
    apiBase: niftyApiBase(),
    hasAccessToken,
    hasRefreshToken,
    hasClientId,
    hasClientSecret,
    hasAuthorizeUrl,
    hasRedirectUri: !!redirectUri,
    canCallApi: hasAccessToken || (hasRefreshToken && hasClientId && hasClientSecret),
    canStartOAuth: hasClientId && hasClientSecret && hasAuthorizeUrl && !!redirectUri,
    redirectUri,
  };
}

export async function niftyOrganizationConfigStatus(organizationId: string): Promise<NiftyConfigStatus> {
  const base = niftyConfigStatus();
  const { data, error } = await createAdminClient().from("work_provider_credentials").select("id,refresh_token_cipher,expires_at").eq("organization_id", organizationId).eq("provider", "nifty").maybeSingle();
  if (error) throw new Error(`load organization Nifty status: ${error.message}`);
  if (!data) {
    const { data: organizations, error: orgError } = await createAdminClient().from("work_organizations").select("id,legacy_owner_id");
    if (orgError) throw new Error(`validate legacy Nifty status: ${orgError.message}`);
    const configuredOwner = env("WORK_OS_LEGACY_NIFTY_OWNER_USER_ID");
    const allowed = configuredOwner
      ? organizations?.some((item) => item.id === organizationId && item.legacy_owner_id === configuredOwner)
      : organizations?.length === 1 && organizations[0].id === organizationId;
    return allowed ? base : { ...base, hasAccessToken: false, hasRefreshToken: false, canCallApi: false };
  }
  const accessValid = !data.expires_at || new Date(data.expires_at).getTime() > Date.now() + 60_000;
  const refreshable = !!data.refresh_token_cipher && base.hasClientId && base.hasClientSecret;
  return { ...base, hasAccessToken: true, hasRefreshToken: !!data.refresh_token_cipher, canCallApi: accessValid || refreshable };
}

async function loadOrganizationToken(organizationId: string): Promise<CachedToken | null> {
  const cached = organizationTokens.get(organizationId);
  if (cached) return cached;
  const { data, error } = await createAdminClient().from("work_provider_credentials")
    .select("access_token_cipher,refresh_token_cipher,expires_at").eq("organization_id", organizationId).eq("provider", "nifty").maybeSingle();
  if (error) throw new Error(`load organization Nifty credential: ${error.message}`);
  if (data) {
    const token = {
      accessToken: decryptProviderSecret(data.access_token_cipher),
      refreshToken: data.refresh_token_cipher ? decryptProviderSecret(data.refresh_token_cipher) : undefined,
      expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : Date.now() + 5 * 60_000,
    };
    organizationTokens.set(organizationId, token);
    return token;
  }
  const configuredOwner = env("WORK_OS_LEGACY_NIFTY_OWNER_USER_ID");
  const { data: organizations, error: organizationError } = await createAdminClient().from("work_organizations").select("id,legacy_owner_id");
  if (organizationError) throw new Error(`validate legacy Nifty credential scope: ${organizationError.message}`);
  const allowed = configuredOwner
    ? organizations?.some((item) => item.id === organizationId && item.legacy_owner_id === configuredOwner)
    : organizations?.length === 1 && organizations[0].id === organizationId;
  if (!allowed) throw new Error("This organization needs its own Nifty connection before provider data can be accessed");
  return null;
}

async function getAccessToken(): Promise<string> {
  const organizationId = organizationContext.getStore();
  if (organizationId) {
    const token = await loadOrganizationToken(organizationId);
    if (token) {
      if (Date.now() < token.expiresAt - 60_000) return token.accessToken;
      if (token.refreshToken) return (await refreshNiftyAccessToken()).access_token;
      throw new Error("This organization's Nifty access token expired and must be reconnected");
    }
  }
  if (legacyToken && Date.now() < legacyToken.expiresAt - 60_000) return legacyToken.accessToken;
  const token = env("NIFTY_ACCESS_TOKEN");
  if (token) return token;

  const refreshed = await refreshNiftyAccessToken();
  return refreshed.access_token;
}

async function refreshNiftyAccessToken(): Promise<NiftyTokenResponse> {
  const clientId = env("NIFTY_CLIENT_ID");
  const clientSecret = env("NIFTY_CLIENT_SECRET");
  const organizationId = organizationContext.getStore();
  const scoped = organizationId ? await loadOrganizationToken(organizationId) : null;
  const existingRefreshToken = organizationId && scoped
    ? scoped.refreshToken
    : legacyToken?.refreshToken ?? env("NIFTY_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !existingRefreshToken) {
    throw new Error("NIFTY_ACCESS_TOKEN or NIFTY_REFRESH_TOKEN with NIFTY_CLIENT_ID/NIFTY_CLIENT_SECRET is required.");
  }

  const token = await requestNiftyToken({
    grant_type: "refresh_token",
    refresh_token: existingRefreshToken,
  });
  const cached = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || existingRefreshToken,
    expiresAt: Date.now() + Math.max(60, token.expires_in || 3600) * 1000,
  };
  if (organizationId && scoped) {
    organizationTokens.set(organizationId, cached);
    const { error } = await createAdminClient().from("work_provider_credentials").update({
      access_token_cipher: encryptProviderSecret(cached.accessToken), refresh_token_cipher: cached.refreshToken ? encryptProviderSecret(cached.refreshToken) : null,
      expires_at: new Date(cached.expiresAt).toISOString(), updated_at: new Date().toISOString(),
    }).eq("organization_id", organizationId).eq("provider", "nifty");
    if (error) throw new Error(`persist refreshed Nifty credential: ${error.message}`);
  } else {
    legacyToken = cached;
  }
  return token;
}

function queryString(params?: NiftyListParams): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) sp.append(`${key}[]`, item);
    } else {
      sp.set(key, value);
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

async function niftyRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const makeRequest = async (token: string) => fetch(`${niftyApiBase()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  let res = await makeRequest(await getAccessToken());
  if (res.status === 401) {
    const refreshed = await refreshNiftyAccessToken();
    res = await makeRequest(refreshed.access_token);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Nifty ${path} -> HTTP ${res.status} ${text.slice(0, 300)}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function str(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function bool(raw: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function firstArray(payload: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.map(asRecord);
  const root = asRecord(payload);
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) return value.map(asRecord);
  }
  return [];
}

function idOf(raw: Record<string, unknown>): string {
  return str(raw, ["id", "_id", "ID", "uid", "short_id", "shortId", "nice_id"]) ?? "unknown";
}

function nameOf(raw: Record<string, unknown>): string {
  return str(raw, ["name", "title", "displayName", "display_name", "fullName", "email"]) ?? idOf(raw);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      const raw = asRecord(item);
      return idOf(raw);
    })
    .filter((item) => item && item !== "unknown");
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function namedValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  const raw = asRecord(value);
  return str(raw, ["name", "label", "value", "title"]) ?? null;
}

function referenceId(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  const id = idOf(asRecord(value));
  return id === "unknown" ? null : id;
}

function labelArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => namedValue(item) ?? referenceId(item)).filter((item): item is string => !!item);
}

export function normalizeNiftyTask(item: Record<string, unknown>): NiftyTaskSummary {
  return {
    id: idOf(item),
    name: nameOf(item),
    projectId: referenceId(item.project_id ?? item.projectId ?? item.project),
    taskGroupId: referenceId(item.task_group_id ?? item.task_group ?? item.taskGroupId ?? item.taskGroup),
    milestoneId: referenceId(item.milestone_id ?? item.milestoneId ?? item.milestone),
    status: namedValue(item.status ?? item.task_status ?? item.taskStatus),
    completed: bool(item, ["completed", "isCompleted"]),
    assignees: stringArray(item.assignees ?? item.assignee_ids ?? item.assigneeIds),
    dueDate: str(item, ["due_date", "dueDate"]) ?? null,
    startDate: str(item, ["start_date", "startDate"]) ?? null,
    completedAt: str(item, ["completed_on", "completed_at", "completedAt", "completion_date", "completionDate"]) ?? null,
    description: str(item, ["description", "body"]) ?? null,
    priority: namedValue(item.priority ?? item.priority_name ?? item.priorityName),
    labels: labelArray(item.labels ?? item.label_ids ?? item.labelIds),
    storyPoints: numberValue(item.story_points ?? item.storyPoints),
    dependencyIds: stringArray(item.dependencies ?? item.dependency_ids ?? item.dependencyIds),
    parentTaskId: referenceId(item.task_id ?? item.parent_task_id ?? item.parentTaskId ?? item.parent_task ?? item.task),
    createdAt: str(item, ["created_at", "createdAt", "date_created", "dateCreated"]) ?? null,
    updatedAt: str(item, ["updated_at", "updatedAt", "modified_at", "modifiedAt"]) ?? null,
    raw: item,
  };
}

export function normalizeNiftyTaskPayload(payload: unknown): NiftyTaskSummary | null {
  const root = asRecord(payload);
  const candidates = [
    root.task,
    root.data,
    root.item,
    root.result,
    payload,
  ];
  for (const candidate of candidates) {
    const raw = asRecord(candidate);
    const id = idOf(raw);
    if (id && id !== "unknown") return normalizeNiftyTask(raw);
  }
  return null;
}

export async function listNiftyProjects(params?: NiftyListParams): Promise<{ projects: NiftyProjectSummary[]; raw: unknown }> {
  const raw = await niftyRequest<unknown>(`/api/v1.0/projects${queryString(params)}`);
  const projects = firstArray(raw, ["items", "projects", "data"]).map((item) => ({
    id: idOf(item),
    name: nameOf(item),
    archived: bool(item, ["archived", "isArchived"]) ?? undefined,
    raw: item,
  }));
  return { projects, raw };
}

export async function listNiftyMembers(): Promise<{ members: NiftyMemberSummary[]; raw: unknown }> {
  const raw = await niftyRequest<unknown>("/api/v1.0/members");
  const members = firstArray(raw, ["members", "items", "data"]).map((item) => ({
    id: idOf(item),
    name: nameOf(item),
    email: str(item, ["email", "Email"]) ?? null,
    raw: item,
  }));
  return { members, raw };
}

export async function listNiftyTasks(params?: NiftyListParams): Promise<{ tasks: NiftyTaskSummary[]; hasMore?: boolean; raw: unknown }> {
  const raw = await niftyRequest<unknown>(`/api/v1.0/tasks${queryString(params)}`);
  const root = asRecord(raw);
  const tasks = firstArray(raw, ["tasks", "items", "data"]).map(normalizeNiftyTask);
  return {
    tasks,
    hasMore: typeof root.hasMore === "boolean" ? root.hasMore : undefined,
    raw,
  };
}

export async function createNiftyTask(body: Record<string, unknown>): Promise<unknown> {
  return niftyRequest("/api/v1.0/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getNiftyTask(taskId: string): Promise<unknown> {
  return niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(taskId)}`);
}

export async function updateNiftyTask(taskId: string, body: Record<string, unknown>): Promise<unknown> {
  return niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(taskId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function updateNiftyTaskField(taskId: string, fieldId: string, value: unknown): Promise<unknown> {
  return niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(taskId)}/fields/${encodeURIComponent(fieldId)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

export async function completeNiftyTask(taskId: string, completed = true): Promise<unknown> {
  return niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(taskId)}/complete`, {
    method: "POST",
    body: JSON.stringify({ completed }),
  });
}

export async function archiveNiftyTask(taskId: string, archived = true): Promise<unknown> {
  return niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(taskId)}/archive`, {
    method: "POST",
    body: JSON.stringify({ archived }),
  });
}

export async function exchangeNiftyAuthorizationCode(code: string, organizationId?: string, userId?: string): Promise<NiftyTokenResponse> {
  const clientId = env("NIFTY_CLIENT_ID");
  const clientSecret = env("NIFTY_CLIENT_SECRET");
  const redirectUri = niftyRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("NIFTY_CLIENT_ID, NIFTY_CLIENT_SECRET, and NIFTY_REDIRECT_URI/NIFTY_REDIRECT_URL are required.");
  }

  const token = await requestNiftyToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const cached = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + Math.max(60, token.expires_in || 3600) * 1000,
  };
  if (organizationId) {
    const { error } = await createAdminClient().from("work_provider_credentials").upsert({
      organization_id: organizationId, provider: "nifty", access_token_cipher: encryptProviderSecret(cached.accessToken),
      refresh_token_cipher: cached.refreshToken ? encryptProviderSecret(cached.refreshToken) : null,
      expires_at: new Date(cached.expiresAt).toISOString(), created_by: userId ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,provider" });
    if (error) throw new Error(`store organization Nifty credential: ${error.message}`);
    organizationTokens.set(organizationId, cached);
  } else {
    legacyToken = cached;
  }
  return token;
}

async function requestNiftyToken(body: Record<string, string>): Promise<NiftyTokenResponse> {
  const clientId = env("NIFTY_CLIENT_ID");
  const clientSecret = env("NIFTY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("NIFTY_CLIENT_ID and NIFTY_CLIENT_SECRET are required.");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${niftyApiBase()}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Nifty /oauth/token -> HTTP ${res.status} ${text.slice(0, 300)}`);
  }

  return (await res.json()) as NiftyTokenResponse;
}
