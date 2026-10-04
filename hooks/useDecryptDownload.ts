"use client";

/**
 * hooks/useDecryptDownload.ts
 *
 * Hook that orchestrates the full in-browser download + decrypt flow:
 *
 *   1. GET /api/files/[fileId]/download  → { presignedUrl, iv, ciphertextHash }
 *   2. fetch(presignedUrl)               → encrypted blob (ciphertext)
 *   3. Verify SHA-256(ciphertext) === ciphertextHash  (integrity check)
 *   4. AES-256-GCM decrypt(ciphertext, key, iv)       → plaintext
 *   5. Trigger browser download of the plaintext
 *
 * The server is bypassed for steps 2-5; the S3 presigned URL goes
 * directly from S3 to the browser.
 *
 * The decrypted file name is recovered by decrypting the encryptedName
 * field that was stored alongside the file.
 */

import { useState } from "react";
import { decryptFile, base64ToBuffer, downloadBuffer } from "@/lib/crypto";

type DownloadStatus = "idle" | "fetching" | "decrypting" | "done" | "error";

interface DownloadState {
  status: DownloadStatus;
  error?: string;
}

export function useDecryptDownload() {
  const [state, setState] = useState<DownloadState>({ status: "idle" });

  async function download(
    fileId: string,
    encryptedName: string,
    key: CryptoKey,
    versionNo?: number
  ) {
    setState({ status: "fetching" });

    try {
      // Step 1: Get presigned URL + IV from our API
      const url = versionNo
        ? `/api/files/${fileId}/download?version=${versionNo}`
        : `/api/files/${fileId}/download`;

      const metaRes = await fetch(url);
      if (!metaRes.ok) {
        const { error } = await metaRes.json().catch(() => ({ error: "Failed to get download URL." }));
        throw new Error(error);
      }

      const { presignedUrl, iv: ivB64, ciphertextHash } = await metaRes.json();

      // Step 2: Fetch ciphertext directly from S3 (bypasses our server)
      const cipherRes = await fetch(presignedUrl);
      if (!cipherRes.ok) throw new Error("Failed to fetch encrypted file from storage.");
      const ciphertext = await cipherRes.arrayBuffer();

      // Step 3: Integrity check — verify SHA-256 before decrypting
      const hashBuf = await crypto.subtle.digest("SHA-256", ciphertext);
      const actualHash = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (actualHash !== ciphertextHash) {
        throw new Error("Integrity check failed — ciphertext hash mismatch. File may have been tampered with.");
      }

      // Step 4: Decrypt in-browser
      setState({ status: "decrypting" });
      const iv = new Uint8Array(base64ToBuffer(ivB64));
      const plaintext = await decryptFile(ciphertext, iv, key);

      // Step 5: Decrypt the file name
      let filename = `securevault-file-${fileId.slice(0, 8)}`;
      try {
        // encryptedName format: "base64iv:base64ciphertext"
        const [nameIvB64, nameCipherB64] = encryptedName.split(":");
        if (nameIvB64 && nameCipherB64) {
          const nameIv = new Uint8Array(base64ToBuffer(nameIvB64));
          const nameCipher = base64ToBuffer(nameCipherB64);
          const nameIvFixed = new Uint8Array(nameIv.buffer as ArrayBuffer, nameIv.byteOffset, nameIv.byteLength);
          const namePlain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: nameIvFixed },
            key,
            nameCipher
          );
          filename = new TextDecoder().decode(namePlain);
        }
      } catch {
        // Fall back to generic name if decryption of name fails
      }

      // Step 6: Trigger browser download
      downloadBuffer(plaintext, filename);
      setState({ status: "done" });

      // Reset to idle after a short delay
      setTimeout(() => setState({ status: "idle" }), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Download failed.";
      setState({ status: "error", error: msg });
    }
  }

  function reset() {
    setState({ status: "idle" });
  }

  return { downloadState: state, download, reset };
}
