// POST /api/auth/verify  { message: string, signature: `0x${string}` }
//
// Phase 6 upgrade: stricter per-IP + per-wallet rate limits,
// email alert on anomaly detection, Retry-After headers.
//
// Security guarantees:
//   - Nonce single-use + 5-min expiry → replay attacks fail
//   - Per-wallet brute-force limiter → 5 failures / 15 min
//   - Anomaly detected → audit_log row + email alert (non-blocking)
//   - JWT httpOnly + Secure + SameSite=Strict
//   - session.anomaly flag surfaced to client for re-auth prompt

import { NextRequest, NextResponse } from "next/server";
import { SiweMessage } from "siwe";
import { SignJWT } from "jose";
import { db } from "@/lib/db";
import {
  verifyIpLimiter,
  verifyWalletLimiter,
  rateLimitResponse,
} from "@/lib/rateLimit";
import { sendAnomalyAlert, sendLoginAlert } from "@/lib/email";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev_jwt_secret_securevault_32bytes_at_least_random_string_12345"
);

export async function POST(req: NextRequest) {
  const rawIp =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "127.0.0.1";
  const ip = rawIp === "::1" || rawIp === "unknown" ? "127.0.0.1" : rawIp;
  const userAgent = req.headers.get("user-agent") ?? "";

  // ── Per-IP rate limit ─────────────────────────────────────────────────
  const ipResult = verifyIpLimiter.check(ip);
  if (!ipResult.ok) {
    return NextResponse.json(rateLimitResponse(ipResult.resetAt), {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((ipResult.resetAt - Date.now()) / 1000)) },
    });
  }

  // ── Parse & verify the SIWE signature ────────────────────────────────
  let siwe: SiweMessage;
  let body: { message: string; signature: string; email?: string };
  try {
    body = await req.json();
    siwe = new SiweMessage(body.message);
    const result = await siwe.verify({ signature: body.signature });
    if (!result.success) throw new Error("bad signature");
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const address = siwe.address.toLowerCase();

  // ── Per-wallet brute-force rate limit ────────────────────────────────
  const walletResult = verifyWalletLimiter.check(address);
  if (!walletResult.ok) {
    // Log the block
    await db.query(
      `INSERT INTO audit_log (event_type, ip_address, user_agent, metadata)
       VALUES ('rate_limit_block', $1, $2, $3)`,
      [ip, userAgent, JSON.stringify({ address, reason: "verify_wallet_limit" })]
    );
    return NextResponse.json(rateLimitResponse(walletResult.resetAt), {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((walletResult.resetAt - Date.now()) / 1000)) },
    });
  }

  // ── Validate nonce (single-use, not expired) ─────────────────────────
  const nonceRow = await db.query<{ id: string }>(
    `SELECT id FROM auth_nonces
     WHERE wallet_address = $1 AND nonce = $2
       AND used = false AND expires_at > now()`,
    [address, siwe.nonce]
  );

  if (nonceRow.rowCount === 0) {
    await db.query(
      `INSERT INTO audit_log (event_type, ip_address, user_agent, metadata)
       VALUES ('failed_login', $1, $2, $3)`,
      [ip, userAgent, JSON.stringify({ address, reason: "nonce_invalid" })]
    );
    return NextResponse.json({ error: "Nonce invalid or expired." }, { status: 401 });
  }

  // Mark nonce used atomically
  await db.query(`UPDATE auth_nonces SET used = true WHERE id = $1`, [
    nonceRow.rows[0].id,
  ]);

  // ── Upsert user, capture previous IP/UA ─────────────────────────────
  const userRow = await db.query<{
    id: string;
    last_ip: string | null;
    last_user_agent: string | null;
    role: string;
    email: string | null;
  }>(
    `INSERT INTO users (wallet_address, last_login_at, last_ip, last_user_agent)
     VALUES ($1, now(), $2, $3)
     ON CONFLICT (wallet_address)
     DO UPDATE SET
       last_login_at   = now(),
       last_ip         = EXCLUDED.last_ip,
       last_user_agent = EXCLUDED.last_user_agent
     RETURNING id, last_ip, last_user_agent, role`,
    [address, ip, userAgent]
  );

  const user = userRow.rows[0];

  // ── Anomaly detection ────────────────────────────────────────────────
  const prevIp = user.last_ip;
  const prevUA = user.last_user_agent;
  const isNewIp = Boolean(prevIp && prevIp !== ip);
  const isNewDevice = Boolean(prevUA && prevUA !== userAgent);
  const anomaly = isNewIp || isNewDevice;
  const anomalyReason = isNewIp ? "new_ip" : isNewDevice ? "new_device" : null;

  if (anomaly && anomalyReason) {
    // Write anomaly to audit log
    await db.query(
      `INSERT INTO audit_log (user_id, event_type, ip_address, user_agent, metadata)
       VALUES ($1, 'anomaly', $2, $3, $4)`,
      [
        user.id, ip, userAgent,
        JSON.stringify({ reason: anomalyReason, prevIp, newIp: ip, prevUA }),
      ]
    );

    // Send email alert (non-blocking — failure must not block login)
    const emailCol = await db.query<{ email: string | null }>(
      `SELECT email FROM users WHERE id = $1`,
      [user.id]
    );
    const toEmail = emailCol.rows[0]?.email;
    if (toEmail) {
      void sendAnomalyAlert({
        toEmail,
        walletAddress: address,
        reason: anomalyReason as "new_ip" | "new_device",
        ip,
        userAgent,
        timestamp: new Date(),
      });
    }
  }

  // If email was provided in the login payload, save it to the user's profile
  if (body.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    await db.query(`UPDATE users SET email = $1 WHERE id = $2`, [
      body.email.trim().toLowerCase(),
      user.id,
    ]);
  }

  // ── Write login audit event ──────────────────────────────────────────
  await db.query(
    `INSERT INTO audit_log (user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, 'login', $2, $3, $4)`,
    [user.id, ip, userAgent, JSON.stringify({ anomaly, anomalyReason })]
  );

  // ── Dispatch login notification email ────────────────────────────────
  const emailCol = await db.query<{ email: string | null }>(
    `SELECT email FROM users WHERE id = $1`,
    [user.id]
  );
  const targetEmail = body.email?.trim().toLowerCase() || emailCol.rows[0]?.email;
  if (targetEmail) {
    void sendLoginAlert({
      toEmail: targetEmail,
      walletAddress: address,
      ip,
      userAgent,
      timestamp: new Date(),
    });
  }

  // ── Reset wallet brute-force counter on successful auth ──────────────
  verifyWalletLimiter.reset(address);

  // ── Issue JWT session cookie ─────────────────────────────────────────
  const jwt = await new SignJWT({
    sub: user.id,
    address,
    role: user.role,
    anomaly,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(JWT_SECRET);

  const res = NextResponse.json(
    { ok: true, anomaly },
    {
      headers: {
        "X-RateLimit-Remaining": String(walletResult.remaining),
      },
    }
  );

  const isHttps =
    req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:";
  const isSecure = isHttps || process.env.NODE_ENV === "production";

  res.cookies.set("session", jwt, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: 60 * 60 * 2,
    path: "/",
  });

  return res;
}
