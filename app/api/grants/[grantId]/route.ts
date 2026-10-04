// DELETE /api/grants/[grantId] — revoke an access grant
// Only the original grantor can revoke.
// Sets revoked_at timestamp; the wrapped_key row remains for audit purposes.
//
// GET /api/grants/[grantId]/key
// Returns the wrapped key for the grantee to use for decryption.
// Only the grantee can call this endpoint.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { db } from "@/lib/db";

interface RouteParams {
  params: Promise<{ grantId: string }>;
}

// ── DELETE — revoke ───────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { grantId } = await params;

  const result = await db.query<{ id: string; file_id: string }>(
    `UPDATE access_grants
     SET revoked_at = now()
     WHERE id = $1 AND granted_by = $2 AND revoked_at IS NULL
     RETURNING id, file_id`,
    [grantId, session.sub]
  );

  if (result.rowCount === 0) {
    return NextResponse.json(
      { error: "Grant not found or already revoked." },
      { status: 404 }
    );
  }

  // Audit log
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  await db.query(
    `INSERT INTO audit_log (user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, 'revoke', $2, $3, $4)`,
    [
      session.sub, ip, req.headers.get("user-agent") ?? "",
      JSON.stringify({ grantId, fileId: result.rows[0].file_id }),
    ]
  );

  return NextResponse.json({ ok: true });
}

// ── GET — retrieve wrapped key (grantee only) ─────────────────────────────
export async function GET(req: NextRequest, { params }: RouteParams) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { grantId } = await params;

  const row = await db.query<{
    wrapped_key: string;
    file_id: string;
    s3_pointer: string;
    iv: string;
    ciphertext_hash: string;
    granted_by_address: string;
    version_no: number;
  }>(
    `SELECT
       ag.wrapped_key,
       ag.file_id,
       fv.s3_pointer,
       fv.iv,
       fv.ciphertext_hash,
       u.wallet_address AS granted_by_address,
       fv.version_no
     FROM access_grants ag
     JOIN users u ON u.id = ag.granted_by
     JOIN files f ON f.id = ag.file_id
     JOIN file_versions fv ON fv.file_id = f.id
       AND fv.version_no = (
         SELECT MAX(v2.version_no) FROM file_versions v2 WHERE v2.file_id = f.id
       )
     WHERE ag.id = $1
       AND ag.granted_to = $2
       AND ag.revoked_at IS NULL
       AND (ag.expires_at IS NULL OR ag.expires_at > now())`,
    [grantId, session.sub]
  );

  if (row.rowCount === 0) {
    return NextResponse.json(
      { error: "Grant not found, revoked, or expired." },
      { status: 404 }
    );
  }

  const { wrapped_key, file_id, s3_pointer, iv, ciphertext_hash, granted_by_address, version_no } =
    row.rows[0];

  // Generate presigned URL so grantee can fetch ciphertext directly
  const { getPresignedDownloadUrl } = await import("@/lib/s3");
  const presignedUrl = await getPresignedDownloadUrl(s3_pointer, 300);

  // Audit log — download via grant
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  await db.query(
    `INSERT INTO audit_log (user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, 'download', $2, $3, $4)`,
    [
      session.sub, ip, req.headers.get("user-agent") ?? "",
      JSON.stringify({ grantId, fileId: file_id, versionNo: version_no, via: "grant" }),
    ]
  );

  return NextResponse.json({
    wrappedKey: wrapped_key,
    grantedByAddress: granted_by_address,
    presignedUrl,
    iv,
    ciphertextHash: ciphertext_hash,
    fileId: file_id,
    versionNo: version_no,
  });
}
