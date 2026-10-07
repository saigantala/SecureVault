// app/api/files/route.ts
// Receives an encrypted file upload from the browser and lists user files.
//
// What the server NEVER sees:
//   - plaintext file content (already AES-256-GCM encrypted client-side)
//   - the file-encryption key (derived client-side from wallet signature)
//
// Uses the hybrid fault-tolerant vaultStore for seamless operation across
// both PostgreSQL and local storage modes.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { uploadCiphertext } from "@/lib/s3";
import { saveFile, listUserFiles, recordAuditEvent } from "@/lib/vaultStore";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB limit

export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse multipart form ──────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  // Metadata fields
  const encryptedName = formData.get("encryptedName") as string | null;
  const ciphertextHash = formData.get("ciphertextHash") as string | null;
  const iv = formData.get("iv") as string | null;
  const sizeBytes = formData.get("sizeBytes") as string | null;
  const mimeType = formData.get("mimeType") as string | null;
  const prevHash = formData.get("prevHash") as string | null;
  const existingFileId = formData.get("fileId") as string | null;
  const ciphertextBlob = formData.get("ciphertext") as File | null;

  if (!encryptedName || !ciphertextHash || !iv || !sizeBytes || !ciphertextBlob) {
    return NextResponse.json(
      { error: "Missing required fields: encryptedName, ciphertextHash, iv, sizeBytes, ciphertext." },
      { status: 400 }
    );
  }

  const size = parseInt(sizeBytes, 10);
  if (isNaN(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Invalid file size." }, { status: 400 });
  }

  if (!/^[0-9a-f]{64}$/.test(ciphertextHash)) {
    return NextResponse.json({ error: "Invalid ciphertext hash format." }, { status: 400 });
  }

  // Deterministic target key path
  const tempFileId = existingFileId || crypto.randomUUID();
  const s3Key = `${session.address.toLowerCase()}/${tempFileId}/v1`;

  // ── Stream upload ciphertext blob directly ─────────────────────────────────
  try {
    await uploadCiphertext(
      s3Key,
      ciphertextBlob.stream() as ReadableStream<Uint8Array>,
      size
    );
  } catch (err) {
    console.error("[api/files/POST] Storage upload error:", err);
    return NextResponse.json({ error: "Storage upload failed." }, { status: 502 });
  }

  // ── Persist file metadata via hybrid vaultStore ─────────────────────────────
  let fileId = tempFileId;
  let versionNo = 1;
  try {
    const saved = await saveFile({
      ownerId: session.sub,
      ownerAddress: session.address,
      encryptedName,
      mimeType: mimeType ?? null,
      ciphertextHash,
      prevHash: prevHash ?? null,
      s3Key,
      size,
      iv,
      fileId: tempFileId,
      existingFileId,
    });
    fileId = saved.fileId;
    versionNo = saved.versionNo;
  } catch (err) {
    console.error("[api/files/POST] Save file metadata failed:", err);
  }

  // ── Record audit log entry (non-blocking) ──────────────────────────────────
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  void recordAuditEvent({
    userId: session.sub,
    walletAddress: session.address,
    eventType: "upload",
    ip,
    userAgent: req.headers.get("user-agent") ?? "",
    metadata: { fileId, versionNo, sizeBytes: size, ciphertextHash },
  });

  return NextResponse.json({ ok: true, fileId, versionNo });
}

// GET /api/files — list the current user's files
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const files = await listUserFiles(session.sub, session.address);
    return NextResponse.json({ files });
  } catch (err) {
    console.warn("[api/files/GET] Warning:", (err as Error).message);
    return NextResponse.json({ files: [] });
  }
}
