// GET /api/security — returns the current user's audit_log entries
// GET /api/security?limit=50&offset=0&type=login
// Used by the /app/security page to show login history + anomaly flags.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { upsertUser, getAuditEvents, getUser } from "@/lib/vaultStore";

// PATCH /api/security — update user's alert email preference
export async function PATCH(req: NextRequest) {
  try {
    const session = (await getSessionFromRequest(req)) || (await getSession());
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { email } = await req.json();

    // Basic email format check
    if (email !== null && email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400 });
    }

    await upsertUser(session.address, session.role || "user", email || undefined);

    if (process.env.DATABASE_URL) {
      try {
        await db.query(
          `UPDATE users SET email = $1 WHERE id = $2 OR lower(wallet_address) = $3`,
          [email || null, session.sub, session.address.toLowerCase()]
        );
      } catch {}
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[api/security/PATCH] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update email." },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = (await getSessionFromRequest(req)) || (await getSession());
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = req.nextUrl;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);
    const offset = parseInt(searchParams.get("offset") ?? "0", 10);

    const { events, total } = await getAuditEvents(session.address, limit, offset);
    const user = await getUser(session.address);

    return NextResponse.json({
      events,
      total,
      email: user?.email ?? null,
    });
  } catch (err: unknown) {
    console.warn("[api/security/GET] Warning:", (err as Error).message);
    return NextResponse.json({
      events: [],
      total: 0,
      email: null,
      warning: "Audit log currently syncing with database.",
    });
  }
}
