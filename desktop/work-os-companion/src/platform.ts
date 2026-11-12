/** Presentation only: the native controller separately rejects unsupported OSes. */
export function isMacOS(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /Macintosh|Mac OS X/i.test(userAgent);
}

/** Presentation only: the custom window chrome is Windows-first. */
export function isWindows(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /Windows/i.test(userAgent);
}
