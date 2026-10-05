// Auth gate for the whole platform (Next.js 16 Proxy, formerly middleware).
// No valid Better Auth session → redirect to /login. The proxy only checks for
// the session cookie's presence (cheap, no network) — authoritative session
// validation happens in requireUser()/requireUserProfile() on routes.
// See WEB-PLATFORM-SPEC.md §6 and docs/NEON-MIGRATION-PLAN.md.
import { NextResponse, type NextRequest } from "next/server";

// Paths reachable without a session.
const PUBLIC_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/api/auth",
  "/api/work-os/desktop/token",
  "/api/work-os/integrations/github/webhook",
  "/api/work-os/integrations/ghl/webhook",
];

const WORK_OS_DESKTOP_ORIGINS = new Set([
  "https://tauri.localhost",
  "http://tauri.localhost",
  "tauri://localhost",
]);

function addDesktopCors(response: NextResponse, origin: string | null) {
  if (!origin || !WORK_OS_DESKTOP_ORIGINS.has(origin)) return response;
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Work-OS-Organization-Id");
  response.headers.append("Vary", "Origin");
  return response;
}

function isPublic(pathname: string): boolean {
  // "/" is the public landing page — page.tsx renders LandingPage for
  // anonymous visitors and Overview for signed-in users.
  if (pathname === "/") return true;
  // Dev-only fixture surface for rendered QA; NODE_ENV is inlined at build
  // time, so this branch cannot exist in a production bundle.
  if (process.env.NODE_ENV !== "production" && pathname === "/work-os-preview") return true;
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

// The Tauri updater fetches installer assets with a one-time grant instead of
// a desktop session; the download route verifies the grant itself.
function isDesktopUpdaterDownload(pathname: string): boolean {
  return /^\/api\/work-os\/desktop\/updates\/[^/]+\/download$/.test(pathname);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get("origin");
  const desktopApiRequest = pathname.startsWith("/api/work-os/") && !!origin && WORK_OS_DESKTOP_ORIGINS.has(origin);
  if (desktopApiRequest && request.method === "OPTIONS") {
    return addDesktopCors(new NextResponse(null, { status: 204 }), origin);
  }

  // Fast local check: presence of the Better Auth session cookie. Routes must
  // still call requireUser()/getSession() for authoritative validation.
  const sessionCookie =
    request.cookies.get("better-auth.session_token")?.value ??
    request.cookies.get("__Secure-better-auth.session_token")?.value;
  const user = sessionCookie ? { id: "present" } : null;
  const response = NextResponse.next();

  const workOsBearer = pathname.startsWith("/api/work-os/") && /^Bearer\s+\S+$/i.test(request.headers.get("authorization") || "");
  // The SEO agent control route validates its own constant-time service token.
  // Let bearer requests reach that route without a browser session; no other SEO
  // route receives this exemption.
  const seoAuthorization = request.headers.get("authorization") || "";
  const seoBearer = seoAuthorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const seoAgentBearer =
    pathname.startsWith("/api/seo/") &&
    !!process.env.SEO_AGENT_API_TOKEN &&
    seoBearer === process.env.SEO_AGENT_API_TOKEN;
  // This one route performs its own constant-time bearer validation in the
  // Node runtime. The proxy only lets bearer-shaped requests reach it.
  const notesAgentBearer =
    pathname === "/api/agent-tools/notes" &&
    /^Bearer\s+\S+$/i.test(request.headers.get("authorization") || "");
  if (!user && !isPublic(pathname) && !workOsBearer && !seoAgentBearer && !notesAgentBearer && !isDesktopUpdaterDownload(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  // NOTE: no "/login -> /" redirect here. A session cookie can be stale
  // (revoked/expired server-side), and the proxy only checks cookie presence —
  // bouncing cookie holders away from /login would trap them in a loop where
  // they can never re-authenticate. The login page is harmless when signed in.

  return desktopApiRequest ? addDesktopCors(response, origin) : response;
}

export const config = {
  // Run on everything except Next internals and static assets. API routes ARE
  // matched on purpose — they must be authenticated too.
  // EXCEPTION: /api/downloads is excluded so Next doesn't buffer+truncate large
  // uploads at proxyClientMaxBodySize (10MB). That route does its own fast
  // getSession() auth check instead. (Add other large-upload routes here too.)
  matcher: [
    "/((?!_next/static|_next/image|api/downloads|api/files/[^/]+/upload|favicon.ico|icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|lottie|wasm)$).*)",
  ],
};
