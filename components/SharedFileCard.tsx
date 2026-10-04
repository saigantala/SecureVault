"use client";

/**
 * components/SharedFileCard.tsx
 *
 * Renders a file that has been explicitly shared with the current user via an access grant.
 *
 * Decryption flow:
 *   1. GET /api/grants/[grantId]/key → { wrappedKey, grantedByAddress, presignedUrl, iv, ciphertextHash }
 *   2. Load current user's ECDH key pair from localStorage (getOrCreateKeyPair)
 *   3. Fetch grantor's ECDH public key from /api/users/[grantedByAddress]/pubkey
 *   4. deriveSharedAesKey(myPrivateKey, grantorPublicKey) → shared AES-KW key
 *   5. unwrapFileKey(wrappedKey, sharedAesKey) → raw AES-256-GCM fileKey
 *   6. Fetch ciphertext from presignedUrl directly (from S3)
 *   7. Verify SHA-256(ciphertext) === ciphertextHash
 *   8. decryptFile(ciphertext, iv, fileKey) → plaintext
 *   9. Trigger browser download!
 *
 * Security: The server NEVER sees the unwrapped file key. The shared key is derived
 * via ECDH on the client side using the grantee's private key.
 */

import { useState } from "react";
import {
  getOrCreateKeyPair,
  importPublicKeyJwk,
  deriveSharedAesKey,
  unwrapFileKey,
} from "@/lib/keyPair";
import { decryptFile, base64ToBuffer, downloadBuffer } from "@/lib/crypto";

export interface ReceivedGrant {
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
}

interface SharedFileCardProps {
  grant: ReceivedGrant;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SharedFileCard({ grant }: SharedFileCardProps) {
  const [downloading, setDownloading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function handleDownload() {
    setDownloading(true);
    setError("");
    setStatusMsg("Retrieving grant data…");

    try {
      // 1. Fetch grant info & presigned S3 url
      const grantRes = await fetch(`/api/grants/${grant.grant_id}/route`);
      // Note: route is /api/grants/[grantId]
      const res = await fetch(`/api/grants/${grant.grant_id}`);
      if (!res.ok) {
        const { error: err } = await res.json().catch(() => ({ error: "Failed to fetch grant." }));
        throw new Error(err || "Failed to fetch grant.");
      }
      const data = await res.json();
      const { wrappedKey, grantedByAddress, presignedUrl, iv: ivB64, ciphertextHash } = data;

      setStatusMsg("Deriving shared decryption key…");
      // 2. Load our ECDH keypair
      const myKeyPair = await getOrCreateKeyPair();

      // 3. Fetch grantor's public key
      const pubRes = await fetch(`/api/users/${grantedByAddress.toLowerCase()}/pubkey`);
      if (!pubRes.ok) throw new Error("Could not find owner's public key.");
      const { publicKey: grantorJwk } = await pubRes.json();
      const grantorPubKey = await importPublicKeyJwk(grantorJwk as JsonWebKey);

      // 4. ECDH derive shared AES-KW key
      const sharedKey = await deriveSharedAesKey(myKeyPair.privateKey, grantorPubKey);

      // 5. Unwrap file key
      const fileKey = await unwrapFileKey(wrappedKey, sharedKey);

      setStatusMsg("Fetching ciphertext from storage…");
      // 6. Fetch encrypted file
      const cipherRes = await fetch(presignedUrl);
      if (!cipherRes.ok) throw new Error("Failed to download file blob.");
      const ciphertext = await cipherRes.arrayBuffer();

      // 7. Verify hash
      const hashBuf = await crypto.subtle.digest("SHA-256", ciphertext);
      const actualHash = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (actualHash !== ciphertextHash) {
        throw new Error("Integrity check failed: file ciphertext hash does not match.");
      }

      setStatusMsg("Decrypting locally…");
      // 8. Decrypt
      const iv = new Uint8Array(base64ToBuffer(ivB64));
      const plaintext = await decryptFile(ciphertext, iv, fileKey);

      // 9. Download
      let filename = `shared-file-${grant.file_id.slice(0, 8)}`;
      try {
        const [nameIvB64, nameCipherB64] = grant.encrypted_name.split(":");
        if (nameIvB64 && nameCipherB64) {
          const nameIv = new Uint8Array(base64ToBuffer(nameIvB64));
          const nameCipher = base64ToBuffer(nameCipherB64);
          const nameIvFixed = new Uint8Array(nameIv.buffer as ArrayBuffer, nameIv.byteOffset, nameIv.byteLength);
          const namePlain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: nameIvFixed },
            fileKey,
            nameCipher
          );
          filename = new TextDecoder().decode(namePlain);
        }
      } catch {
        // Fallback
      }

      downloadBuffer(plaintext, filename);
      setStatusMsg("Downloaded ✓");
      setTimeout(() => setStatusMsg(""), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Download failed.";
      setError(msg);
      setStatusMsg("");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="vault-card flex flex-col gap-3 border-indigo-900/40 bg-indigo-950/10">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-900/40 border border-indigo-700/50 flex items-center justify-center text-lg flex-shrink-0">
          🔗
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-200">Shared with you</span>
            <span className="badge-syncing">Access Grant</span>
            <span className="text-xs text-gray-500 font-mono">v{grant.version_no}</span>
          </div>

          <div className="flex gap-2 mt-1 text-xs text-gray-400 flex-wrap">
            <span>From: <strong className="font-mono text-gray-300">{grant.granted_by_address.slice(0, 6)}…{grant.granted_by_address.slice(-4)}</strong></span>
            <span>·</span>
            <span>{formatBytes(grant.size_bytes)}</span>
            <span>·</span>
            <span>Shared: {formatDate(grant.created_at)}</span>
            {grant.expires_at && (
              <>
                <span>·</span>
                <span className="text-amber-400">Expires: {new Date(grant.expires_at).toLocaleDateString()}</span>
              </>
            )}
          </div>
        </div>

        <button
          onClick={handleDownload}
          disabled={downloading}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-all disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
        >
          {downloading ? (
            <>
              <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
              {statusMsg || "Decrypting…"}
            </>
          ) : statusMsg ? (
            statusMsg
          ) : (
            "↓ Decrypt & Save"
          )}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-950 border border-red-800 text-red-200 text-xs">
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}
