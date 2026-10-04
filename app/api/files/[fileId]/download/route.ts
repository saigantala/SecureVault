// GET /api/files/[fileId]/download?version=N
// Returns a short-lived presigned S3 URL so the browser can fetch
// the ciphertext blob directly, then decrypt it client-side.
//
// Security:
//   - Auth required (session cookie checked)
//   - Ownership enforced in the DB query
//   - Presigned URL expires in 5 minutes
//   - Audit log entry written for every download
//   - Server never touches the ciphertext content

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { getPresignedDownloadUrl } from "@/lib/s3";

interface RouteParams {
  params: Promise<{ fileId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;
  const versionParam = req.nextUrl.searchParams.get("version");

  // Build query — default to latest version
  const versionFilter = versionParam
    ? `AND fv.version_no = ${parseInt(versionParam, 10)}`
    : `AND fv.version_no = (SELECT MAX(v2.version_no) FROM file_versions v2 WHERE v2.file_id = f.id)`;

  const row = await db.query<{
    s3_pointer: string;
    iv: string;
    ciphertext_hash: string;
    version_no: number;
    size_bytes: number;
  }>(
    `SELECT fv.s3_pointer, fv.iv, fv.ciphertext_hash, fv.version_no, fv.size_bytes
     FROM files f
     JOIN file_versions fv ON fv.file_id = f.id
     WHERE f.id = $1
       AND f.owner_id = $2
       AND f.deleted_at IS NULL
       ${versionFilter}
     LIMIT 1`,
    [fileId, session.sub]
  );

  if (row.rowCount === 0) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const { s3_pointer, iv, ciphertext_hash, version_no, size_bytes } = row.rows[0];

  // Generate a short-lived presigned URL (5 min)
  const presignedUrl = await getPresignedDownloadUrl(s3_pointer, 300);

  // Audit log
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  await db.query(
    `INSERT INTO audit_log (user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, 'download', $2, $3, $4)`,
    [
      session.sub,
      ip,
      req.headers.get("user-agent") ?? "",
      JSON.stringify({ fileId, versionNo: version_no, ciphertextHash: ciphertext_hash }),
    ]
  );

  return NextResponse.json({
    presignedUrl,
    iv,                               // base64 IV — needed to decrypt
    ciphertextHash: ciphertext_hash,  // for client-side integrity check before decrypt
    versionNo: version_no,
    sizeBytes: size_bytes,
  });
}
