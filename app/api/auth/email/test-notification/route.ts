import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { sendLoginAlert } from "@/lib/email";

export async function POST(req: NextRequest) {
  try {
    const session = (await getSessionFromRequest(req)) || (await getSession());
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rawIp =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      "127.0.0.1";
    const ip = rawIp === "::1" || rawIp === "unknown" ? "127.0.0.1" : rawIp;
    const userAgent = req.headers.get("user-agent") ?? "SecureVault Client";

    // Fetch user's registered email
    const userRow = await db.query<{ email: string | null }>(
      `SELECT email FROM users WHERE id = $1`,
      [session.sub]
    );

    const email = userRow.rows[0]?.email;
    if (!email) {
      return NextResponse.json(
        { error: "No email registered. Please enter an email first." },
        { status: 400 }
      );
    }

    const result = await sendLoginAlert({
      toEmail: email,
      walletAddress: session.address,
      ip,
      userAgent,
      timestamp: new Date(),
    });

    return NextResponse.json({
      ok: true,
      message: `Test login notification dispatched to ${email}.`,
      previewUrl: result.previewUrl,
    });
  } catch (err: unknown) {
    console.error("[api/auth/email/test-notification] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to dispatch test notification." },
      { status: 500 }
    );
  }
}
