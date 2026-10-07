// app/api/files/[fileId]/download/route.ts
// Returns a short-lived download URL so the browser can fetch
// the ciphertext blob directly, then decrypt it client-side.
//
// Security:
//   - Auth required (session cookie checked)
//   - Ownership enforced in the query
//   - Audit log entry recorded for every download
//   - Server never touches plaintext content

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { getFileDownloadMeta, recordAuditEvent } from "@/lib/vaultStore";

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
  const versionNo = versionParam ? parseInt(versionParam, 10) : undefined;

  const meta = await getFileDownloadMeta(fileId, session.sub, session.address, versionNo);

  if (!meta) {
    return NextResponse.json({ error: "File not found or access denied." }, { status: 404 });
  }

  const { s3_pointer, iv, ciphertext_hash, version_no, size_bytes } = meta;

  // Generate a short-lived download URL
  const presignedUrl = await getPresignedDownloadUrl(s3_pointer, 300);

  // Record download audit event (non-blocking)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  void recordAuditEvent({
    userId: session.sub,
    walletAddress: session.address,
    eventType: "download",
    ip,
    userAgent: req.headers.get("user-agent") ?? "",
    metadata: { fileId, versionNo: version_no, ciphertextHash: ciphertext_hash },
  });

  return NextResponse.json({
    presignedUrl,
    iv,
    ciphertextHash: ciphertext_hash,
    versionNo: version_no,
    sizeBytes: size_bytes,
  });
}
