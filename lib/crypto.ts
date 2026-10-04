// lib/crypto.ts
// Client-side file encryption — runs entirely in the browser via Web Crypto API.
// The derived key NEVER leaves the browser and is NEVER sent to the server.

/**
 * Derive a file-encryption key from the user's wallet signature using HKDF.
 *
 * Security properties:
 * - Same wallet → same key, deterministically (no server round-trip needed)
 * - Key is marked non-extractable: once derived it can only be used,
 *   never read back out of the browser's crypto subsystem
 * - An optional per-file salt can be provided to produce per-file keys
 */
export async function deriveFileKey(
  walletSignature: string,
  salt: string = "securevault-v1"
): Promise<CryptoKey> {
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(walletSignature),
    "HKDF",
    false,       // not extractable
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode(salt),
      info: enc.encode("file-encryption-key"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,       // not extractable — key can never be read back out
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a File object using AES-256-GCM.
 *
 * Returns:
 *   ciphertext  – the encrypted ArrayBuffer (IV is NOT prepended; stored separately)
 *   iv          – 12-byte random IV (store alongside the ciphertext pointer)
 *   sha256Hex   – hex SHA-256 of the ciphertext (for integrity / DB storage)
 */
export async function encryptFile(
  file: File,
  key: CryptoKey
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array; sha256Hex: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = await file.arrayBuffer();

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );

  const hashBuf = await crypto.subtle.digest("SHA-256", ciphertext);
  const sha256Hex = [...new Uint8Array(hashBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { ciphertext, iv, sha256Hex };
}

/**
 * Decrypt a ciphertext ArrayBuffer using AES-256-GCM.
 * Returns the plaintext ArrayBuffer — trigger a download from this in the browser.
 */
export async function decryptFile(
  ciphertext: ArrayBuffer,
  iv: Uint8Array,
  key: CryptoKey
): Promise<ArrayBuffer> {
  // Cast to Uint8Array<ArrayBuffer> — TS5 Web Crypto types require ArrayBuffer, not ArrayBufferLike
  const ivFixed = new Uint8Array(iv.buffer as ArrayBuffer, iv.byteOffset, iv.byteLength);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: ivFixed }, key, ciphertext);
}

/**
 * Encode an ArrayBuffer as a base64 string for transport in JSON.
 */
export function bufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/**
 * Decode a base64 string back to an ArrayBuffer.
 */
export function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Trigger a browser file download from an ArrayBuffer.
 */
export function downloadBuffer(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
