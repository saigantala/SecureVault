import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  try {
    const session = (await getSessionFromRequest(req)) || (await getSession());
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const email = body.email?.trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Please provide a valid email address." }, { status: 400 });
    }

    // Generate random 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Save to database
    await db.query(
      `INSERT INTO email_verifications (user_id, email, code, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [session.sub, email, code, expiresAt]
    );

    // Send verification email
    const result = await sendVerificationEmail({
      toEmail: email,
      code,
      walletAddress: session.address,
    });

    return NextResponse.json({
      ok: true,
      message: `Verification code sent to ${email}.`,
      previewUrl: result.previewUrl,
      // If in dev or test account mode, include code for immediate testing
      code: result.previewUrl || !process.env.SMTP_HOST ? code : undefined,
    });
  } catch (err: unknown) {
    console.error("[api/auth/email/send-code] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send verification code." },
      { status: 500 }
    );
  }
}
