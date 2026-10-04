// GET /api/admin/metrics
// Admin-only API for aggregate system metrics and full audit log.
//
// Security guarantees:
//   - Strict role check: session.role === 'admin' required (403 otherwise).
//   - NO plaintext or decryption keys are exposed.
//   - files/file_versions content is NEVER exposed to the admin API.
//   - Only aggregate counters + metadata and explicitly granted files are returned.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Admin role required." }, { status: 403 });
  }

  // ── 1. Aggregate metrics ────────────────────────────────────────────────
  const [
    userCountResult,
    storageResult,
    fileCountResult,
    failedLoginResult,
    rateLimitResult,
    anomalyResult,
    activeGrantsResult,
  ] = await Promise.all([
    db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM users`),
    db.query<{ total_bytes: string }>(
      `SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes FROM file_versions`
    ),
    db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM files WHERE deleted_at IS NULL`),
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM audit_log WHERE event_type = 'failed_login'`
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM audit_log WHERE event_type = 'rate_limit_block'`
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM audit_log WHERE event_type = 'anomaly'`
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM access_grants
       WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`
    ),
  ]);

  // ── 2. Audit logs (latest 100 entries with user wallet address) ─────────
  const auditLogsResult = await db.query<{
    id: string;
    user_id: string | null;
    wallet_address: string | null;
    event_type: string;
    ip_address: string | null;
    user_agent: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>(
    `SELECT a.id, a.user_id, u.wallet_address, a.event_type,
            a.ip_address::text, a.user_agent, a.metadata, a.created_at
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC
     LIMIT 100`
  );

  // ── 3. Files explicitly granted to the admin ────────────────────────────
  // Admin only has access to files where an explicit access_grants row exists!
  const sharedWithAdminResult = await db.query<{
    grant_id: string;
    file_id: string;
    wrapped_key: string;
    expires_at: string | null;
    created_at: string;
    encrypted_name: string;
    mime_type: string | null;
    granted_by_address: string;
    version_no: number;
    ciphertext_hash: string;
    size_bytes: number;
  }>(
    `SELECT ag.id AS grant_id,
            ag.file_id,
            ag.wrapped_key,
            ag.expires_at,
            ag.created_at,
            f.encrypted_name,
            f.mime_type,
            u.wallet_address AS granted_by_address,
            fv.version_no,
            fv.ciphertext_hash,
            fv.size_bytes
     FROM access_grants ag
     JOIN users u ON u.id = ag.granted_by
     JOIN files f ON f.id = ag.file_id
     JOIN file_versions fv ON fv.file_id = f.id
       AND fv.version_no = (
         SELECT MAX(v2.version_no) FROM file_versions v2 WHERE v2.file_id = f.id
       )
     WHERE ag.granted_to = $1
       AND ag.revoked_at IS NULL
       AND (ag.expires_at IS NULL OR ag.expires_at > now())
       AND f.deleted_at IS NULL
     ORDER BY ag.created_at DESC`,
    [session.sub]
  );

  return NextResponse.json({
    metrics: {
      totalUsers: parseInt(userCountResult.rows[0].count, 10),
      totalStorageBytes: parseInt(storageResult.rows[0].total_bytes, 10),
      totalFiles: parseInt(fileCountResult.rows[0].count, 10),
      failedLogins: parseInt(failedLoginResult.rows[0].count, 10),
      rateLimitBlocks: parseInt(rateLimitResult.rows[0].count, 10),
      anomaliesDetected: parseInt(anomalyResult.rows[0].count, 10),
      activeGrants: parseInt(activeGrantsResult.rows[0].count, 10),
    },
    auditLogs: auditLogsResult.rows,
    sharedWithAdmin: sharedWithAdminResult.rows,
  });
}
