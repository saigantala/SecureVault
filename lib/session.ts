// lib/session.ts
// Server-side session helpers: verify the httpOnly JWT cookie.
// Imported by middleware and server components / API routes.

import { jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev_jwt_secret_securevault_32bytes_at_least_random_string_12345"
);

export interface SessionPayload extends JWTPayload {
  sub: string;    // user UUID
  address: string; // wallet address (lowercase)
  role: string;   // 'user' | 'admin'
  anomaly?: boolean;
}

/**
 * Verify the session cookie from a server component / route handler.
 * Returns the decoded payload or null if absent / expired / tampered.
 */
export async function getSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("session")?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Verify the session cookie from a NextRequest (middleware context).
 */
export async function getSessionFromRequest(
  req: NextRequest
): Promise<SessionPayload | null> {
  try {
    const token = req.cookies.get("session")?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
