// app/api/files/[fileId]/route.ts
// Soft-deletes a file using hybrid vaultStore.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { deleteVaultFile, recordAuditEvent } from "@/lib/vaultStore";

interface RouteParams {
  params: Promise<{ fileId: string }>;
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;
  const deleted = await deleteVaultFile(fileId, session.sub, session.address);

  if (!deleted) {
    return NextResponse.json({ error: "File not found or already deleted." }, { status: 404 });
  }

  // Audit log
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  void recordAuditEvent({
    userId: session.sub,
    walletAddress: session.address,
    eventType: "delete",
    ip,
    userAgent: req.headers.get("user-agent") ?? "",
    metadata: { fileId },
  });

  return NextResponse.json({ ok: true });
}
