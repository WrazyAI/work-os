// Session helper for the Next.js Proxy (formerly middleware). This is an
// OPTIMISTIC gate only: it reads the session from cookies LOCALLY (no network
// round-trip), so it can't hang the whole app on a slow/unreachable Supabase
// Auth endpoint. Authoritative verification (getUser(), which hits the network)
// happens in protected routes via requireUser(). This matches Next's guidance
// that proxy/middleware should do optimistic checks, not full auth.
// See WEB-PLATFORM-SPEC.md §6.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getSession() reads + decodes the session from the cookie locally. It does
  // NOT make a network call for a present, unexpired token (unlike getUser()),
  // so the proxy stays fast and never hangs the request.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return { response, user: session?.user ?? null };
}
