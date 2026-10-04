// middleware.ts — Next.js edge middleware
//
// Protects every route under /app/* and /admin/*.
// Reads the httpOnly "session" cookie, verifies the JWT,
// and redirects to /login if the session is absent or invalid.
// Admin routes additionally require role === 'admin'.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";

export const config = {
  matcher: [
    "/app/:path*",   // all authenticated user routes
    "/admin/:path*", // admin-only routes
  ],
};

export async function middleware(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const { pathname } = req.nextUrl;

  // ── No valid session → redirect to /login ──────────────────────────────
  if (!session) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Admin routes require role === 'admin' ──────────────────────────────
  if (pathname.startsWith("/admin") && session.role !== "admin") {
    const homeUrl = req.nextUrl.clone();
    homeUrl.pathname = "/app/dashboard";
    return NextResponse.redirect(homeUrl);
  }

  // ── Pass the user ID downstream via a request header ──────────────────
  // (so layout server components can read it without re-verifying the JWT)
  const res = NextResponse.next();
  res.headers.set("x-user-id", session.sub);
  res.headers.set("x-user-address", session.address);
  res.headers.set("x-user-role", session.role);
  return res;
}
