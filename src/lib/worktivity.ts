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

/** `/Screenshots/List` ignores StartDate/EndDate unless DateFilter selects a
 * preset. 10 is the API's custom-range value; its window behaves as
 * [startDate, startDate + ~48h] and returns newest-first, so requests span the
 * day on both sides and the frames are then filtered to the exact day here.
 * Provider filtering is advisory — this local filter is the contract. */
export const WT_SCREENSHOT_CUSTOM_RANGE = 10;
const SCREENSHOT_PAGE_SIZE = 100;
const SCREENSHOT_MAX_PAGES = 8;
/** The prepare loop asks for the same day several times within a minute. */
const SCREENSHOT_DAY_CACHE_MS = 90_000;
const screenshotDayCache = new Map<string, { at: number; frames: WtScreenshot[] }>();

/** Keeps only frames captured inside the requested UTC day. Exported so the
 * day boundary is unit-tested independently of the provider. */
export function framesWithinDay<T extends { CaptureDate?: string | null; CreateDate?: string | null }>(frames: T[], date: string): T[] {
  const start = Date.parse(`${date}T00:00:00.000Z`);
  const end = Date.parse(`${date}T23:59:59.999Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return frames.filter((frame) => {
    const at = Date.parse(frame.CaptureDate || frame.CreateDate || "");
    return Number.isFinite(at) && at >= start && at <= end;
  });
}

function shiftIsoDate(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Screenshots live on the dedicated /Screenshots/List endpoint — the
 * /ActivityLogs/List Screenshot field stays null for this organization. The
 * provider has ignored narrow filters at page boundaries before, so filter by
 * employee and by day client-side and dedupe by ID. */
export async function fetchScreenshotsForDay(employeeId: string, date: string): Promise<WtScreenshot[]> {
  const cacheKey = `${employeeId}:${date}`;
  const cached = screenshotDayCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SCREENSHOT_DAY_CACHE_MS) return cached.frames;

  const collected = new Map<string, WtScreenshot>();
  let page = 1;
  let pageCount = 1;
  let emptyPages = 0;
  do {
    const data = await wtPost<WtPaged<WtScreenshot>>("/Screenshots/List", {
      EmployeeId: employeeId,
      DateFilter: WT_SCREENSHOT_CUSTOM_RANGE,
      startDate: `${shiftIsoDate(date, -1)}T00:00:00Z`,
      endDate: `${shiftIsoDate(date, 1)}T23:59:59Z`,
      Page: page,
      PageSize: SCREENSHOT_PAGE_SIZE,
    });
    const items = (data.Items ?? []).filter((shot) => shot.EmployeeId === employeeId && !!shot.Screenshot && !!shot.ID);
    for (const item of items) collected.set(item.ID, item);
    pageCount = data.PageCount ?? 1;
    emptyPages = items.length ? 0 : emptyPages + 1;
    page += 1;
    // The provider occasionally returns an empty page mid-run; pause briefly
    // and keep going rather than treating it as the end of the data.
    if (page <= pageCount && page <= SCREENSHOT_MAX_PAGES) await sleep(emptyPages ? 400 : 250);
  } while (page <= pageCount && page <= SCREENSHOT_MAX_PAGES && emptyPages < 2);

  const frames = framesWithinDay([...collected.values()], date).sort((left, right) =>
    String(left.CaptureDate || left.CreateDate).localeCompare(String(right.CaptureDate || right.CreateDate)));
  screenshotDayCache.set(cacheKey, { at: Date.now(), frames });
  if (screenshotDayCache.size > 40) {
    const oldest = [...screenshotDayCache.entries()].sort((left, right) => left[1].at - right[1].at)[0];
    if (oldest) screenshotDayCache.delete(oldest[0]);
  }
  return frames;
}
