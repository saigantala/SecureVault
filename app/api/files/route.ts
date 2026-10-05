// POST /api/files
// Receives an encrypted file upload from the browser.
//
// What the server NEVER sees:
//   - plaintext file content (already AES-256-GCM encrypted client-side)
//   - the file-encryption key (derived client-side from wallet signature)
//
// What the server receives:
//   - ciphertext blob (streamed directly to S3 — never buffered in RAM)
//   - SHA-256 hash of the ciphertext (for integrity / DB indexing)
//   - base64-encoded IV (needed to decrypt later — not secret, just random)
//   - encrypted file name (AES-GCM encrypted client-side)
//   - optional mime-type hint (encrypted client-side)
//   - file size (ciphertext length, for storage metrics)
//
// Every upload is written to audit_log.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { uploadCiphertext } from "@/lib/s3";

// Multipart field names sent by the upload page
// The form uses a "file" part (raw ciphertext blob) + JSON metadata part.
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB hard limit

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

  // Metadata fields (all sent as plain text — the *values* are already encrypted)
  const encryptedName = formData.get("encryptedName") as string | null;
  const ciphertextHash = formData.get("ciphertextHash") as string | null;
  const iv = formData.get("iv") as string | null;
  const sizeBytes = formData.get("sizeBytes") as string | null;
  const mimeType = formData.get("mimeType") as string | null; // optional
  const prevHash = formData.get("prevHash") as string | null; // for versioning
  const existingFileId = formData.get("fileId") as string | null; // for versioning
  const ciphertextBlob = formData.get("ciphertext") as File | null;

  // Validate required fields
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

  // Validate SHA-256 hex format
  if (!/^[0-9a-f]{64}$/.test(ciphertextHash)) {
    return NextResponse.json({ error: "Invalid ciphertext hash format." }, { status: 400 });
  }

  // ── DB: look up user ─────────────────────────────────────────────────────
  const userRow = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE id = $1`,
    [session.sub]
  );
  if (userRow.rowCount === 0) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // ── DB: resolve file_id (new upload vs new version) ──────────────────────
  let fileId: string;
  let versionNo: number;

  if (existingFileId) {
    // Uploading a new version of an existing file
    const fileCheck = await db.query<{ id: string }>(
      `SELECT id FROM files WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [existingFileId, session.sub]
    );
    if (fileCheck.rowCount === 0) {
      return NextResponse.json({ error: "File not found or access denied." }, { status: 404 });
    }
    fileId = existingFileId;

    const versionRow = await db.query<{ max: string }>(
      `SELECT MAX(version_no) as max FROM file_versions WHERE file_id = $1`,
      [fileId]
    );
    versionNo = parseInt(versionRow.rows[0].max ?? "0", 10) + 1;
  } else {
    // Brand new file
    const fileRow = await db.query<{ id: string }>(
      `INSERT INTO files (owner_id, encrypted_name, mime_type)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [session.sub, encryptedName, mimeType ?? null]
    );
    fileId = fileRow.rows[0].id;
    versionNo = 1;
  }

  // ── S3: stream ciphertext directly — no plaintext buffering ──────────────
  const s3Key = `${session.sub}/${fileId}/v${versionNo}`;
  try {
    await uploadCiphertext(
      s3Key,
      ciphertextBlob.stream() as ReadableStream<Uint8Array>,
      size
    );
  } catch (err) {
    console.error("S3 upload failed:", err);
    // Roll back the file row if this was a new file
    if (versionNo === 1) {
      await db.query(`DELETE FROM files WHERE id = $1`, [fileId]);
    }
    return NextResponse.json({ error: "Storage upload failed." }, { status: 502 });
  }

  // ── DB: insert file_versions row ─────────────────────────────────────────
  await db.query(
    `INSERT INTO file_versions
       (file_id, version_no, ciphertext_hash, prev_hash, s3_pointer, size_bytes, iv)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [fileId, versionNo, ciphertextHash, prevHash ?? null, s3Key, size, iv]
  );

  // ── Audit log ─────────────────────────────────────────────────────────────
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  await db.query(
    `INSERT INTO audit_log (user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, 'upload', $2, $3, $4)`,
    [
      session.sub,
      ip,
      req.headers.get("user-agent") ?? "",
      JSON.stringify({ fileId, versionNo, sizeBytes: size, ciphertextHash }),
    ]
  );

  return NextResponse.json({ ok: true, fileId, versionNo });
}

// GET /api/files — list the current user's files (most recent version per file)
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.sub);
    if (!isUuid || !process.env.DATABASE_URL) {
      return NextResponse.json({ files: [] });
    }

    const rows = await db.query<{
      file_id: string;
      encrypted_name: string;
      mime_type: string | null;
      created_at: string;
      version_no: number;
      ciphertext_hash: string;
      s3_pointer: string;
      size_bytes: number;
      iv: string;
      prev_hash: string | null;
    }>(
      `SELECT
         f.id            AS file_id,
         f.encrypted_name,
         f.mime_type,
         f.created_at,
         fv.version_no,
         fv.ciphertext_hash,
         fv.s3_pointer,
         fv.size_bytes,
         fv.iv,
         fv.prev_hash
       FROM files f
       JOIN file_versions fv ON fv.file_id = f.id
       WHERE f.owner_id = $1
         AND f.deleted_at IS NULL
         AND fv.version_no = (
           SELECT MAX(v2.version_no) FROM file_versions v2 WHERE v2.file_id = f.id
         )
       ORDER BY f.created_at DESC`,
      [session.sub]
    );

    return NextResponse.json({ files: rows.rows });
  } catch (err) {
    console.warn("[api/files/GET] Warning:", (err as Error).message);
    return NextResponse.json({ files: [] });
  }
}
