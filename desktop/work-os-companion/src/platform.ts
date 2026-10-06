/** Presentation only: the native controller separately rejects unsupported OSes. */
export function isMacOS(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /Macintosh|Mac OS X/i.test(userAgent);
}
