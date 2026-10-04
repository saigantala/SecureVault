import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, getSession } from "@/lib/session";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const session = (await getSessionFromRequest(req)) || (await getSession());
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "127.0.0.1";
    const userAgent = req.headers.get("user-agent") ?? "";

    const body = await req.json();
    const email = body.email?.trim().toLowerCase();
    const code = body.code?.trim();

    if (!email || !code) {
      return NextResponse.json({ error: "Email and verification code are required." }, { status: 400 });
    }

    // Verify code in database
    const verifRow = await db.query<{ id: string }>(
      `SELECT id FROM email_verifications
       WHERE user_id = $1 AND lower(email) = lower($2) AND code = $3
         AND used = false AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1`,
      [session.sub, email, code]
    );

    if (verifRow.rowCount === 0) {
      return NextResponse.json(
        { error: "Invalid or expired verification code. Please request a new one." },
        { status: 400 }
      );
    }

    // Mark code as used
    await db.query(`UPDATE email_verifications SET used = true WHERE id = $1`, [
      verifRow.rows[0].id,
    ]);

    // Update user record: email and email_verified = true
    await db.query(
      `UPDATE users SET email = $1, email_verified = true WHERE id = $2`,
      [email, session.sub]
    );

    // Audit log
    await db.query(
      `INSERT INTO audit_log (user_id, event_type, ip_address, user_agent, metadata)
       VALUES ($1, 'email_verified', $2, $3, $4)`,
      [session.sub, ip === "unknown" ? "127.0.0.1" : ip, userAgent, JSON.stringify({ email })]
    );

    return NextResponse.json({
      ok: true,
      message: "Email address verified successfully!",
    });
  } catch (err: unknown) {
    console.error("[api/auth/email/verify-code] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to verify code." },
      { status: 500 }
    );
  }
}
