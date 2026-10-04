// GET /api/users/[address]/pubkey
// Returns the ECDH public key JWK for any registered wallet address.
// Used by the owner to import the grantee's public key before wrapping.
//
// PUT /api/users/[address]/pubkey  { publicKey: JsonWebKey }
// Saves the caller's own ECDH public key (only the JWT subject can do this).

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { db } from "@/lib/db";

interface RouteParams {
  params: Promise<{ address: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { address } = await params;

  const row = await db.query<{ public_key: Record<string, unknown> | null }>(
    `SELECT public_key FROM users WHERE wallet_address = $1`,
    [address.toLowerCase()]
  );

  if (row.rowCount === 0 || !row.rows[0].public_key) {
    return NextResponse.json(
      { error: "User has no public key registered." },
      { status: 404 }
    );
  }

  return NextResponse.json({ publicKey: row.rows[0].public_key });
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { address } = await params;

  // Only the session owner can update their own key
  if (session.address !== address.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { publicKey } = await req.json();
  if (!publicKey || typeof publicKey !== "object") {
    return NextResponse.json({ error: "publicKey JWK required." }, { status: 400 });
  }

  // Minimal JWK sanity check
  if (publicKey.kty !== "EC" || publicKey.crv !== "P-256") {
    return NextResponse.json(
      { error: "publicKey must be a P-256 EC JWK." },
      { status: 400 }
    );
  }

  await db.query(
    `UPDATE users SET public_key = $1 WHERE id = $2`,
    [JSON.stringify(publicKey), session.sub]
  );

  return NextResponse.json({ ok: true });
}
