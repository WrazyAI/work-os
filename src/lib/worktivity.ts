// Server-side Worktivity Open API client.
// Docs: https://open-api.useworktivity.com/swagger/index.html
//
// Auth is a query param (`x_api_key`) on every request — NOT a header. The key
// lives in WORKTIVITY_API_KEY (.env) and must never reach the browser, so all
// Worktivity calls go through /api/worktivity/* route handlers, never client fetch.
//
// Rate limits (enforced by Worktivity): 5/sec, 100/min, 1000/hour — which is why
// the route handlers cache responses for a few seconds and coalesce.

const BASE = "https://open-api.useworktivity.com";
const MAX_RETRIES = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelayMs(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }
  return Math.min(10_000, 500 * 2 ** attempt);
}

export function worktivityConfigured(): boolean {
  return !!process.env.WORKTIVITY_API_KEY;
}

interface WtEnvelope<T> {
  HasError: boolean;
  Message: string | null;
  ValidationErrors?: unknown[];
  Data: T;
}

/** POST to a Worktivity endpoint and return the unwrapped `Data` field. */
export async function wtPost<T = unknown>(path: string, body: unknown = {}, init: { signal?: AbortSignal } = {}): Promise<T> {
  const key = process.env.WORKTIVITY_API_KEY;
  if (!key) throw new Error("WORKTIVITY_API_KEY not configured");

  const url = `${BASE}${path}?x_api_key=${encodeURIComponent(key)}`;
  let r: Response | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (init.signal?.aborted) throw init.signal.reason;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        cache: "no-store",
        signal: init.signal,
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      if (attempt < MAX_RETRIES) { await sleep(Math.min(10_000, 500 * 2 ** attempt)); continue; }
      throw error;
    }
    if ((r.status === 429 || r.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(r, attempt));
      continue;
    }
    break;
  }

  if (!r?.ok) {
    const text = await r?.text().catch(() => "") ?? "";
    throw new Error(`Worktivity ${path} → HTTP ${r?.status ?? "network error"} ${text.slice(0, 200)}`);
  }
  const j = (await r.json()) as WtEnvelope<T>;
  if (j?.HasError) throw new Error(j?.Message || `Worktivity ${path} returned an error`);
  return j.Data;
}

// ---- Shared shapes (only the fields we surface) ----

export interface WtPaged<T> {
  Items: T[];
  TotalCount: number;
  PageCount: number;
}

export interface WtActivityLog {
  ID: string;
  UserId: string;
  EmployeeId: string;
  Url: string | null;
  Screenshot: string | null; // pre-signed S3 URL, valid ~24h
  ScreenCount: number;
  ActivityLevel: number; // raw active seconds per one-minute capture (observed 0–60)
  // EmployeeActivityLogStatus: 0 ClockIn · 1 Working · 2 OnBreak · 3 Idle · 4 ClockOut · 5 YetToStart
  Status: number;
  Productivity: number | null;
  Title: string | null;
  WorkNote: string | null;
  ProjectId: string | null;
  ClockIn: string | null;
  ClockOut: string | null;
  CreateDate: string;
}

export interface WtEmployee {
  UserId: string;
  ID: string;
  Role: number;
  IsActive: boolean;
  Blocked: boolean;
  EnableScreenshots: boolean;
  Title: string | null;
  Statistics: { Status: number; ClockIn: string | null; ClockOut: string | null } | null;
  Invitation: { FirstName: string | null; LastName: string | null; Email: string | null } | null;
}

/** Friendly display name for an employee (User obj is null in list mode; names live on Invitation). */
export function employeeName(e: WtEmployee): string {
  const inv = e.Invitation;
  const full = [inv?.FirstName, inv?.LastName].filter(Boolean).join(" ").trim();
  return full || inv?.Email || e.Title || e.UserId.slice(-6);
}

export interface WtScreenshot {
  ID: string;
  EmployeeId: string;
  EmployeeActivityLogId: string | null;
  Screenshot: string | null; // pre-signed object URL; LinkExpireDate is re-issued per request
  CaptureDate: string;
  CreateDate: string;
  ActivityLevel: number | null;
  Status: number;
  Url: string | null;
  Title: string | null;
  OrganizationAppId: string | null;
}

/** Screenshots live on the dedicated /Screenshots/List endpoint — the
 * /ActivityLogs/List Screenshot field stays null for this organization. The
 * provider has ignored narrow filters at page boundaries before, so filter by
 * employee client-side and dedupe by ID. */
export async function fetchScreenshotsForDay(employeeId: string, date: string): Promise<WtScreenshot[]> {
  const all: WtScreenshot[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const data = await wtPost<WtPaged<WtScreenshot>>("/Screenshots/List", {
      StartDate: `${date}T00:00:00Z`,
      EndDate: `${date}T23:59:59Z`,
      EmployeeId: employeeId,
      Page: page,
      PageSize: 100,
    });
    all.push(...(data.Items ?? []));
    pageCount = data.PageCount ?? 1;
    page += 1;
    if (page <= pageCount) await sleep(250); // stay under the shared 5 req/s limit
  } while (page <= pageCount);
  return [...new Map(
    all
      .filter((shot) => shot.EmployeeId === employeeId && !!shot.Screenshot)
      .map((shot) => [shot.ID, shot] as const),
  ).values()].sort((left, right) =>
    String(left.CaptureDate || left.CreateDate).localeCompare(String(right.CaptureDate || right.CreateDate)));
}
