// GET /api/security — returns the current user's audit_log entries
// GET /api/security?limit=50&offset=0&type=login
// Used by the /app/security page to show login history + anomaly flags.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, getSession } from "@/lib/session";
import { db } from "@/lib/db";

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

    await db.query(
      `UPDATE users SET email = $1 WHERE id = $2`,
      [email || null, session.sub]
    );

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
    const type = searchParams.get("type")?.trim(); // filter by event_type

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.sub);

    // Match events for this user ID, or events logged for their wallet address
    const conditions: string[] = [
      isUuid
        ? `(user_id = $1 OR (user_id IS NULL AND lower(metadata->>'address') = lower($2)))`
        : `(lower(metadata->>'address') = lower($1))`,
    ];
    const queryParams: (string | number)[] = isUuid
      ? [session.sub, session.address.toLowerCase()]
      : [session.address.toLowerCase()];

    if (type) {
      queryParams.push(type);
      conditions.push(`event_type = $${queryParams.length}`);
    }

    const whereClause = conditions.join(" AND ");

    // 1. Count query parameters
    const countParams = [...queryParams];
    const countRow = await db.query<{ total: string }>(
      `SELECT COUNT(*) as total FROM audit_log WHERE ${whereClause}`,
      countParams
    );

    // 2. Main query with LIMIT and OFFSET
    queryParams.push(limit);
    const limitIndex = queryParams.length;
    queryParams.push(offset);
    const offsetIndex = queryParams.length;

    const rows = await db.query<{
      id: string;
      event_type: string;
      ip_address: string | null;
      user_agent: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>(
      `SELECT id, event_type, ip_address::text, user_agent, metadata, created_at
       FROM audit_log
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      queryParams
    );

    // 3. User's saved email preference
    let userEmail: string | null = null;
    if (isUuid) {
      try {
        const userRow = await db.query<{ email: string | null }>(
          `SELECT email FROM users WHERE id = $1`,
          [session.sub]
        );
        userEmail = userRow.rows[0]?.email ?? null;
      } catch {}
    }

    return NextResponse.json({
      events: rows.rows,
      total: parseInt(countRow.rows[0]?.total ?? "0", 10),
      email: userEmail,
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
