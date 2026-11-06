import type { GhlScope } from "./work-os-ghl-types";

const GHL_API_ORIGIN = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "v3";
const REQUEST_TIMEOUT_MS = 20_000;

export type GhlFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface GhlClient {
  read(input: {
    path: string;
    query?: Record<string, string | number | boolean | null | undefined>;
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
  }): Promise<unknown>;
}

/** Read-only endpoint shapes this integration understands. A `*` matches one
 * non-empty path segment. Everything else is refused before a request. */
const READ_PATTERNS: string[][] = [
  ["users", "search"],
  ["users", "*"],
  ["locations", "*"],
  ["conversations", "search"],
  ["conversations", "messages", "export"],
  ["conversations", "messages", "email", "*"],
  ["conversations", "messages", "*"],
  ["conversations", "*", "messages"],
  ["calendars"],
  ["calendars", "events"],
  ["calendars", "events", "appointments", "*"],
  ["contacts", "search"],
  ["contacts", "*", "notes"],
  ["contacts", "*", "tasks"],
  ["opportunities", "search"],
  ["opportunities", "pipelines"],
  ["opportunities", "*"],
];

/** Documented read/search operations served as POST. They may not mutate. */
const POST_READ_PATTERNS: string[][] = [["locations", "*", "tasks", "search"]];

function matchesPattern(segments: string[], pattern: string[]): boolean {
  if (segments.length !== pattern.length) return false;
  return pattern.every((part, index) => part === "*" ? segments[index]!.length > 0 : segments[index] === part);
}

function parseSegments(path: string): string[] | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.includes("\\") || path.includes("?") || path.includes("#") || path.includes("://")) return null;
  const segments = path.slice(1).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments;
}

function assertLocation(scope: GhlScope, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  if (String(value) !== scope.locationId) throw new Error("GHL request location does not match the connected location");
}

function buildQuery(scope: GhlScope, query: Record<string, string | number | boolean | null | undefined> | undefined) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (key === "locationId") assertLocation(scope, value);
    params.set(key, String(value));
  }
  return params;
}

/** Creates a client bound to one location. It refuses unknown paths, mutation
 * methods, redirects and cross-location requests, and never includes provider
 * response bodies or credentials in an error message. */
export function createGhlClient(input: {
  scope: GhlScope;
  token: string;
  fetchImpl?: GhlFetch;
}): GhlClient {
  const { scope, token } = input;
  const fetchImpl: GhlFetch = input.fetchImpl ?? ((url, init) => fetch(url, init));

  return {
    async read({ path, query, method = "GET", body }) {
      const segments = parseSegments(path);
      if (!segments) throw new Error("GHL request path is not allowed");
      const getAllowed = READ_PATTERNS.some((pattern) => matchesPattern(segments, pattern));
      const postAllowed = POST_READ_PATTERNS.some((pattern) => matchesPattern(segments, pattern));
      if (method === "GET" && !getAllowed) throw new Error(`GHL read path ${path} is not allowed`);
      if (method === "POST" && !postAllowed) throw new Error(`GHL read path ${path} is not allowed as a POST read`);
      if (method !== "GET" && method !== "POST") throw new Error("GHL request method is not allowed");

      assertLocation(scope, body?.locationId);
      const params = buildQuery(scope, query);

      const url = `${GHL_API_ORIGIN}${path}${params.size ? `?${params.toString()}` : ""}`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            Version: GHL_API_VERSION,
            ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
          },
          ...(method === "POST" && body ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        throw new Error(`GHL request failed for ${path}`);
      }
      if (response.status >= 300 && response.status < 400) {
        throw new Error(`GHL read redirect rejected (${response.status}) for ${path}`);
      }
      if (!response.ok) throw new Error(`GHL read failed for ${path} (status ${response.status})`);
      const text = await response.text().catch(() => "");
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`GHL read returned an invalid response for ${path}`);
      }
    },
  };
}
