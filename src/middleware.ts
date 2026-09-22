import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic edge guard: it only checks whether the session cookie is present,
 * so it stays dependency-free and never touches the database on the Edge.
 *
 * The *authoritative* checks live in `src/lib/session.ts` and run inside every
 * protected layout, page and server action (Node runtime, real DB lookup).
 */
const SESSION_COOKIE = "mscw_session";

export function middleware(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  const { pathname, search } = request.nextUrl;
  if (pathname !== "/") {
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/words/:path*",
    "/crossword/:path*",
    "/admin/:path*",
    "/perfil/:path*",
  ],
};
