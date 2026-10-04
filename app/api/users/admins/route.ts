// GET /api/users/admins
// Returns a list of admin wallet addresses and whether they have a public key registered.
// Used by the "Share with admin" action.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.query<{ wallet_address: string; has_pubkey: boolean }>(
    `SELECT wallet_address, (public_key IS NOT NULL) AS has_pubkey
     FROM users
     WHERE role = 'admin'
     ORDER BY created_at ASC`
  );

  return NextResponse.json({ admins: rows.rows });
}
