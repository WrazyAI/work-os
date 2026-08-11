export interface WorkOsBreakWindow {
  start: string;
  end: string;
}

function timeMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function validateWorkOsTimezone(value: unknown) {
  const timezone = typeof value === "string" ? value.trim() : "";
  if (!timezone) throw new Error("timezone is required");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new Error("timezone must be a valid IANA timezone");
  }
  return timezone;
}

export function validateWorkOsTime(value: unknown, label: string) {
  const time = typeof value === "string" ? value.trim() : "";
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) {
    throw new Error(`${label} must be an HH:MM time`);
  }
  return time;
}

export function validateWorkOsDate(value: unknown, label: string) {
  const date = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${label} must be a YYYY-MM-DD date`);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${label} must be a valid calendar date`);
  }
  return date;
}

export function validateWorkOsDateRange(effectiveFrom: string, effectiveTo: string | null) {
  if (effectiveTo && effectiveTo < effectiveFrom) throw new Error("effective_to cannot be before effective_from");
  return { effectiveFrom, effectiveTo };
}

export function validateWorkOsBreakWindows(value: unknown, shiftStart?: string, shiftEnd?: string) {
  const rows = Array.isArray(value) ? value.slice(0, 8) : [];
  const windows = rows.map((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      start: validateWorkOsTime(row.start, `break ${index + 1} start`),
      end: validateWorkOsTime(row.end, `break ${index + 1} end`),
    };
  });
  if (!shiftStart || !shiftEnd || !windows.length) return windows;

  const start = timeMinutes(shiftStart);
  const end = timeMinutes(shiftEnd);
  const shiftDuration = end > start ? end - start : end + 1440 - start;
  const normalized = windows.map((window, index) => {
    const breakStart = (timeMinutes(window.start) - start + 1440) % 1440;
    let breakEnd = (timeMinutes(window.end) - start + 1440) % 1440;
    if (breakEnd <= breakStart) breakEnd += 1440;
    if (breakEnd <= breakStart || breakEnd > shiftDuration) {
      throw new Error(`break ${index + 1} must fall within the configured shift`);
    }
    return { ...window, breakStart, breakEnd };
  }).sort((left, right) => left.breakStart - right.breakStart);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].breakStart < normalized[index - 1].breakEnd) {
      throw new Error("break windows cannot overlap");
    }
  }
  return normalized.map(({ start: breakStart, end: breakEnd }) => ({ start: breakStart, end: breakEnd }));
}
