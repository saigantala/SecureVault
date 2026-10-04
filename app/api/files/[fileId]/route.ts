// DELETE /api/files/[fileId]
// Soft-deletes a file (sets deleted_at). Does NOT delete the S3 object
// immediately — a background job should do that so accidental deletes
// can be recovered during a grace period.
// Hard-delete (S3 + DB) can be added in Phase 9.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { db } from "@/lib/db";

interface RouteParams {
  params: Promise<{ fileId: string }>;
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;

  const result = await db.query<{ id: string }>(
    `UPDATE files SET deleted_at = now()
     WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [fileId, session.sub]
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  // Audit log
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  await db.query(
    `INSERT INTO audit_log (user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, 'delete', $2, $3, $4)`,
    [session.sub, ip, req.headers.get("user-agent") ?? "", JSON.stringify({ fileId })]
  );

  return NextResponse.json({ ok: true });
}
