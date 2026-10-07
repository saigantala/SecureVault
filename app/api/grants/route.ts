// POST /api/grants           — create an access grant
// GET  /api/grants?fileId=X  — list grants for a file (owner only)

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { db } from "@/lib/db";

// ── POST — create grant ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fileId, grantedToAddress, wrappedKey, expiresAt } = await req.json();

  if (!fileId || !grantedToAddress || !wrappedKey) {
    return NextResponse.json(
      { error: "fileId, grantedToAddress, and wrappedKey are required." },
      { status: 400 }
    );
  }

  // Verify file ownership
  const fileRow = await db.query<{ id: string }>(
    `SELECT id FROM files WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [fileId, session.sub]
  );
  if (fileRow.rowCount === 0) {
    return NextResponse.json({ error: "File not found or access denied." }, { status: 404 });
  }

  // Resolve grantee user ID
  const granteeRow = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE wallet_address = $1`,
    [grantedToAddress.toLowerCase()]
  );
  if (granteeRow.rowCount === 0) {
    return NextResponse.json(
      { error: "Grantee wallet has never signed in to SecureVault." },
      { status: 404 }
    );
  }

  // Prevent granting to yourself
  if (granteeRow.rows[0].id === session.sub) {
    return NextResponse.json({ error: "Cannot share a file with yourself." }, { status: 400 });
  }

  // Prevent duplicate active grant for the same file+grantee
  const dupCheck = await db.query(
    `SELECT id FROM access_grants
     WHERE file_id = $1 AND granted_to = $2
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())`,
    [fileId, granteeRow.rows[0].id]
  );
  if ((dupCheck.rowCount ?? 0) > 0) {
    return NextResponse.json(
      { error: "An active grant already exists for this file and grantee." },
      { status: 409 }
    );
  }

  // Insert grant
  const grantRow = await db.query<{ id: string }>(
    `INSERT INTO access_grants
       (file_id, granted_by, granted_to, wrapped_key, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      fileId,
      session.sub,
      granteeRow.rows[0].id,
      wrappedKey,
      expiresAt ? new Date(expiresAt) : null,
    ]
  );

  // Audit log
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  await db.query(
    `INSERT INTO audit_log (user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, 'grant', $2, $3, $4)`,
    [
      session.sub, ip, req.headers.get("user-agent") ?? "",
      JSON.stringify({ fileId, grantedTo: grantedToAddress, grantId: grantRow.rows[0].id }),
    ]
  );

  return NextResponse.json({ ok: true, grantId: grantRow.rows[0].id });
}

// ── GET — list grants for a file OR received grants ──────────────────────
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const received = req.nextUrl.searchParams.get("received") === "true";
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.sub);

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(received ? { receivedGrants: [] } : { grants: [] });
  }

  try {
    if (received) {
      const rows = await db.query<{
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
         JOIN users grantee ON grantee.id = ag.granted_to
         WHERE (ag.granted_to = $1 OR lower(grantee.wallet_address) = $2)
           AND ag.revoked_at IS NULL
           AND (ag.expires_at IS NULL OR ag.expires_at > now())
           AND f.deleted_at IS NULL
         ORDER BY ag.created_at DESC`,
        [isUuid ? session.sub : "00000000-0000-0000-0000-000000000000", session.address.toLowerCase()]
      );

      return NextResponse.json({ receivedGrants: rows.rows });
    }

    const fileId = req.nextUrl.searchParams.get("fileId");
    if (!fileId) return NextResponse.json({ error: "fileId or received=true required." }, { status: 400 });

    const ownerCheck = await db.query(
      `SELECT f.id FROM files f
       JOIN users u ON u.id = f.owner_id
       WHERE f.id = $1 AND (f.owner_id = $2 OR lower(u.wallet_address) = $3) AND f.deleted_at IS NULL`,
      [fileId, isUuid ? session.sub : "00000000-0000-0000-0000-000000000000", session.address.toLowerCase()]
    );
    if (ownerCheck.rowCount === 0) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }

    const rows = await db.query<{
      id: string;
      granted_to_address: string;
      expires_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }>(
      `SELECT ag.id, u.wallet_address AS granted_to_address,
              ag.expires_at, ag.revoked_at, ag.created_at
       FROM access_grants ag
       JOIN users u ON u.id = ag.granted_to
       WHERE ag.file_id = $1
       ORDER BY ag.created_at DESC`,
      [fileId]
    );

    return NextResponse.json({ grants: rows.rows });
  } catch (err) {
    console.warn("[api/grants/GET] Warning:", (err as Error).message);
    return NextResponse.json(received ? { receivedGrants: [] } : { grants: [] });
  }
}
