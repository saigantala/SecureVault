// lib/s3.ts
// S3-compatible object storage client with automatic local filesystem fallback for development.
// Server-side only — never imported by client components.

import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";

// Detect if we should use local filesystem storage (ideal for local dev / testing)
const isLocalStorage =
  process.env.STORAGE_DRIVER === "local" ||
  !process.env.S3_ACCESS_KEY_ID ||
  process.env.S3_ACCESS_KEY_ID === "mock_dev_access_key";

const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), ".storage");

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT || undefined,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "dev_access_key",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "dev_secret_key",
  },
  forcePathStyle: !!process.env.S3_ENDPOINT,
});

export const BUCKET = process.env.S3_BUCKET || "securevault-files";

/**
 * Stream-upload a ciphertext blob.
 * If S3 credentials are not configured or STORAGE_DRIVER=local, stores under .storage/
 * Otherwise streams directly to S3/R2 without RAM buffering.
 */
export async function uploadCiphertext(
  key: string,
  body: ReadableStream<Uint8Array>,
  size: number
): Promise<string> {
  // Convert Web ReadableStream → Node Readable
  const nodeStream = Readable.fromWeb(body as import("stream/web").ReadableStream<Uint8Array>);

  if (isLocalStorage) {
    const fullPath = path.resolve(LOCAL_STORAGE_DIR, key);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const writeStream = fs.createWriteStream(fullPath);
    await pipeline(nodeStream, writeStream);
    return key;
  }

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: key,
      Body: nodeStream,
      ContentLength: size,
      ContentType: "application/octet-stream",
      ACL: "private",
    },
    queueSize: 1,
  });

  await upload.done();
  return key;
}

/**
 * Generate a download URL for a ciphertext blob.
 * In local mode: returns `/api/storage/${key}`
 * In cloud mode: returns an S3 presigned URL
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = 300
): Promise<string> {
  if (isLocalStorage) {
    return `/api/storage/${key}`;
  }

  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}

/**
 * Delete a ciphertext object (used when a file is hard-deleted).
 */
export async function deleteCiphertext(key: string): Promise<void> {
  if (isLocalStorage) {
    const fullPath = path.resolve(LOCAL_STORAGE_DIR, key);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch {}
    }
    return;
  }

  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
