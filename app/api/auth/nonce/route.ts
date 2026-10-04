// GET /api/auth/nonce?address=0x...
// Issues a one-time nonce the client will embed in the SIWE message it signs.
//
// Rate limits (Phase 6 upgrade):
//   - 10 req / 60 s per IP
//   - 5  req / 60 s per wallet address

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import {
  nonceIpLimiter,
  nonceWalletLimiter,
  rateLimitResponse,
} from "@/lib/rateLimit";

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

  // ── Per-IP rate limit ─────────────────────────────────────────────────
  const ipResult = nonceIpLimiter.check(ip);
  if (!ipResult.ok) {
    return NextResponse.json(rateLimitResponse(ipResult.resetAt), {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((ipResult.resetAt - Date.now()) / 1000)),
        "X-RateLimit-Remaining": "0",
      },
    });
  }

  const address = req.nextUrl.searchParams.get("address");
  if (!address || !ETH_ADDRESS_RE.test(address)) {
    return NextResponse.json(
      { error: "Valid Ethereum address required." },
      { status: 400 }
    );
  }

  const normalizedAddress = address.toLowerCase();

  // ── Per-wallet rate limit ─────────────────────────────────────────────
  const walletResult = nonceWalletLimiter.check(normalizedAddress);
  if (!walletResult.ok) {
    return NextResponse.json(rateLimitResponse(walletResult.resetAt), {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((walletResult.resetAt - Date.now()) / 1000)),
        "X-RateLimit-Remaining": "0",
      },
    });
  }

  const nonce = randomBytes(16).toString("hex"); // 32 hex chars
  const expiresAt = new Date(Date.now() + 5 * 60_000); // 5-min TTL

  await db.query(
    `INSERT INTO auth_nonces (wallet_address, nonce, expires_at)
     VALUES ($1, $2, $3)`,
    [normalizedAddress, nonce, expiresAt]
  );

  return NextResponse.json(
    { nonce },
    {
      headers: {
        "X-RateLimit-Remaining": String(walletResult.remaining),
      },
    }
  );
}
