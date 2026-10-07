// GET /api/users/[address]/pubkey
// Returns the ECDH public key JWK for any registered wallet address.
// Used by the owner to import the grantee's public key before wrapping.
//
// PUT /api/users/[address]/pubkey  { publicKey: JsonWebKey }
// Saves the caller's own ECDH public key (only the JWT subject can do this).

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getUserPublicKey, updateUserPublicKey } from "@/lib/vaultStore";

interface RouteParams {
  params: Promise<{ address: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { address } = await params;
  try {
    const publicKey = await getUserPublicKey(address);
    if (!publicKey) {
      return NextResponse.json(
        { error: "User has no public key registered." },
        { status: 404 }
      );
    }
    return NextResponse.json({ publicKey });
  } catch (err) {
    console.warn("[api/users/pubkey/GET] Error:", (err as Error).message);
    return NextResponse.json(
      { error: "Failed to retrieve public key." },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { address } = await params;

  // Only the session owner can update their own key
  if (session.address.toLowerCase() !== address.toLowerCase()) {
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

  try {
    await updateUserPublicKey(session.address, publicKey);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/users/pubkey/PUT] Error:", err);
    return NextResponse.json(
      { error: "Failed to store public key." },
      { status: 500 }
    );
  }
}
