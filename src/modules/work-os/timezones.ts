// WebView2 builds before Chromium 111 may not implement supportedValuesOf.
// Keep a useful IANA fallback bundled instead of asking people to type an ID.
export const FALLBACK_TIMEZONES = [
  "UTC", "Africa/Accra", "Africa/Cairo", "Africa/Johannesburg", "America/Anchorage", "America/Chicago",
  "America/Denver", "America/Los_Angeles", "America/New_York", "America/Sao_Paulo", "Asia/Dubai",
  "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Atlantic/Reykjavik", "Australia/Sydney", "Europe/Berlin",
  "Europe/London", "Europe/Paris", "Pacific/Auckland",
] as const;

export function supportedTimezones() {
  try {
    const values = Intl.supportedValuesOf?.("timeZone") ?? [];
    return [...new Set(["UTC", ...values])];
  } catch {
    return [...FALLBACK_TIMEZONES];
  }
}

export function timezoneLabel(timezone: string, at = new Date()) {
  const city = timezone === "UTC" ? "Coordinated Universal Time" : timezone.replace(/_/g, " ").split("/").at(-1) ?? timezone;
  try {
    const offset = new Intl.DateTimeFormat("en", { timeZone: timezone, timeZoneName: "shortOffset" })
      .formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "";
    return `${city} (${offset || timezone})`;
  } catch { return timezone; }
}
