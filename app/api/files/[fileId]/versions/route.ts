// GET /api/files/[fileId]/versions
// Returns the full version history for a file the current user owns.
// Used by the version-history drawer on the Files page.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { db } from "@/lib/db";

interface RouteParams {
  params: Promise<{ fileId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;

  // Verify ownership first
  const ownerCheck = await db.query<{ id: string }>(
    `SELECT id FROM files WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [fileId, session.sub]
  );
  if (ownerCheck.rowCount === 0) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  // Return all versions newest-first
  const rows = await db.query<{
    id: string;
    version_no: number;
    ciphertext_hash: string;
    prev_hash: string | null;
    s3_pointer: string;
    size_bytes: number;
    iv: string;
    onchain_tx_hash: string | null;
    created_at: string;
  }>(
    `SELECT id, version_no, ciphertext_hash, prev_hash,
            s3_pointer, size_bytes, iv, onchain_tx_hash, created_at
     FROM file_versions
     WHERE file_id = $1
     ORDER BY version_no DESC`,
    [fileId]
  );

  return NextResponse.json({ versions: rows.rows });
}
