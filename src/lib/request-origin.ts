function normalizedOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

export function hasExpectedPublicOrigin(request: Request): boolean {
  const requestOrigin = normalizedOrigin(request.headers.get("origin"));
  if (!requestOrigin) return false;

  const configuredOrigin = normalizedOrigin(process.env.APP_PUBLIC_ORIGIN);
  const expectedOrigin = configuredOrigin ?? normalizedOrigin(request.url);

  return requestOrigin === expectedOrigin;
}
