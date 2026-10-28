import type { AdminSection, AdminSectionFocus } from "../admin/types";

const ADMIN_ROOT = "/work-os/admin/";
const PERSON_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const UNSAFE_VALUE = /[\u0000-\u001f\u007f<>"'`\\:/]/;
const MAX_VALUE = 512;

function cleanValue(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_VALUE) return null;
  if (UNSAFE_VALUE.test(trimmed)) return null;
  return trimmed;
}

function singleParam(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? cleanValue(values[0]) : null;
}

function exactKeys(params: URLSearchParams, keys: string[]): boolean {
  const present = [...params.keys()];
  return present.length === keys.length && keys.every((key) => params.getAll(key).length === 1);
}

/** The only record URL shape the administration read catalog emits:
 * `/work-os/admin/...` with one exact value. A model reply is never parsed for
 * links, and anything absolute, scheme-relative, encoded to escape a segment,
 * or carrying an extra destination is refused. */
export function safeAdminRecordHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 2048) return null;
  if (!raw.startsWith(ADMIN_ROOT) || raw.startsWith("//") || raw.includes("\\")) return null;
  if (raw.includes("#") || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  const rawPath = raw.split("?")[0] ?? "";
  if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath) || /%2e/i.test(rawPath)) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://work-os.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://work-os.invalid") return null;
  if (url.pathname === "/work-os/admin/tasks") {
    if (!exactKeys(url.searchParams, ["task"]) || !singleParam(url.searchParams, "task")) return null;
  } else if (url.pathname === "/work-os/admin/review") {
    if (!exactKeys(url.searchParams, ["report"]) || !singleParam(url.searchParams, "report")) return null;
  } else if (url.pathname.startsWith("/work-os/admin/people/")) {
    const encoded = url.pathname.slice("/work-os/admin/people/".length);
    let personId: string;
    try {
      personId = decodeURIComponent(encoded);
    } catch {
      return null;
    }
    if (!personId || personId === "." || personId === ".." || personId.includes("/")
      || !PERSON_SEGMENT.test(personId)) return null;
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 1) return null;
    const query = keys[0];
    if (query !== "recap") return null;
    if (!singleParam(url.searchParams, query)) return null;
  } else {
    return null;
  }
  return `${url.pathname}${url.search}`;
}

export type AdminRecordTarget = { section: AdminSection; focus: AdminSectionFocus };

/** Split a validated record URL into the real administration destination. A
 * reviewed recap maps to the admin recap focus target (`recapId`), never to an
 * EOD report id. */
export function parseAdminRecordHref(value: unknown): AdminRecordTarget | null {
  const safe = safeAdminRecordHref(value);
  if (!safe) return null;
  const url = new URL(safe, "https://work-os.invalid");
  if (url.pathname === "/work-os/admin/tasks") {
    return { section: "tasks", focus: { taskId: singleParam(url.searchParams, "task") ?? undefined } };
  }
  if (url.pathname === "/work-os/admin/review") {
    return { section: "review", focus: { reportId: singleParam(url.searchParams, "report") ?? undefined } };
  }
  const personId = decodeURIComponent(url.pathname.slice("/work-os/admin/people/".length));
  const recapId = singleParam(url.searchParams, "recap");
  const workdayId = singleParam(url.searchParams, "workday");
  const updateId = singleParam(url.searchParams, "update");
  return {
    section: "people",
    focus: {
      personId,
      ...(recapId ? { recapId } : {}),
      ...(workdayId ? { workdayId } : {}),
      ...(updateId ? { updateId } : {}),
    },
  };
}

/** A record link is only navigable when the app can honour the destination. */
export function isAdminRecordHref(value: unknown): value is string {
  return safeAdminRecordHref(value) !== null;
}
