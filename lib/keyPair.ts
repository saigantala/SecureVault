// lib/keyPair.ts
// Per-user ECDH (P-256) key pair management — browser-side only.
//
// Purpose: asymmetric key-wrapping for file sharing.
//   1. Each user generates a P-256 ECDH key pair.
//   2. Public key is uploaded to the server (users.public_key).
//   3. Private key is persisted in localStorage as a plain JWK.
//      (P-256 private keys are ~32 bytes — small attack surface;
//       the bigger risk is a malicious page, not exfiltration over the wire)
//
// Sharing flow:
//   Owner:     ECDH(myPrivKey, recipientPubKey) → sharedSecret
//              wrapKey(fileKey[extractable], AES-KW, sharedSecret) → wrappedKey
//              POST /api/grants { fileId, wrappedKey, grantedToAddress, expiresAt }
//
//   Recipient: ECDH(myPrivKey, ownerPubKey) → sharedSecret  (same value)
//              unwrapKey(wrappedKey, AES-KW, sharedSecret) → fileKey
//              AES-GCM decrypt(ciphertext, fileKey, iv) → plaintext

const STORAGE_KEY = "sv:ecdhKeyPair";

export interface SerializedKeyPair {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
}

/** Generate a fresh P-256 ECDH key pair. */
export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,               // extractable — needed to persist private key as JWK
    ["deriveKey"]
  );
}

/** Export a key pair to plain JWK for localStorage storage. */
export async function serializeKeyPair(kp: CryptoKeyPair): Promise<SerializedKeyPair> {
  const [publicJwk, privateJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", kp.publicKey),
    crypto.subtle.exportKey("jwk", kp.privateKey),
  ]);
  return { publicJwk, privateJwk };
}

/** Save key pair to localStorage. */
export async function storeKeyPair(kp: CryptoKeyPair): Promise<void> {
  const serialized = await serializeKeyPair(kp);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
}

/** Load and reconstruct the key pair from localStorage. Returns null if absent. */
export async function loadKeyPair(): Promise<CryptoKeyPair | null> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const { publicJwk, privateJwk }: SerializedKeyPair = JSON.parse(raw);

    const [publicKey, privateKey] = await Promise.all([
      crypto.subtle.importKey(
        "jwk", publicJwk,
        { name: "ECDH", namedCurve: "P-256" },
        true, []
      ),
      crypto.subtle.importKey(
        "jwk", privateJwk,
        { name: "ECDH", namedCurve: "P-256" },
        true, ["deriveKey"]
      ),
    ]);

    return { publicKey, privateKey };
  } catch {
    return null;
  }
}

/** Load existing key pair or generate and persist a new one. */
export async function getOrCreateKeyPair(): Promise<CryptoKeyPair> {
  const existing = await loadKeyPair();
  if (existing) return existing;

  const kp = await generateECDHKeyPair();
  await storeKeyPair(kp);
  return kp;
}

/** Derive an AES-256-KW key from an ECDH exchange (owner private × grantee public). */
export async function deriveSharedAesKey(
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: theirPublicKey },
    myPrivateKey,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  );
}

/**
 * Import a public key JWK received from the server.
 * Used by the owner to import the grantee's public key before wrapping.
 */
export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk", jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true, []
  );
}

/**
 * Derive an EXTRACTABLE copy of the file key for wrapping.
 * Only called when the user explicitly initiates sharing.
 * The raw bytes are never stored — they are wrapped immediately and discarded.
 */
export async function deriveFileKeyExtractable(
  walletSignature: string,
  salt = "securevault-v1"
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(walletSignature), "HKDF", false, ["deriveKey"]
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
    true,                        // extractable — required for wrapKey
    ["encrypt", "decrypt"]
  );
}

/**
 * Wrap the file key under the ECDH-derived AES-256-KW shared secret.
 * Returns a base64-encoded wrapped key blob.
 */
export async function wrapFileKey(
  fileKey: CryptoKey,
  sharedAesKey: CryptoKey
): Promise<string> {
  const wrapped = await crypto.subtle.wrapKey("raw", fileKey, sharedAesKey, "AES-KW");
  return btoa(String.fromCharCode(...new Uint8Array(wrapped)));
}

/**
 * Unwrap a file key using the ECDH-derived AES-256-KW shared secret.
 * Returns a non-extractable AES-256-GCM CryptoKey ready for decryption.
 */
export async function unwrapFileKey(
  wrappedB64: string,
  sharedAesKey: CryptoKey
): Promise<CryptoKey> {
  const wrapped = Uint8Array.from(atob(wrappedB64), (c) => c.charCodeAt(0));
  return crypto.subtle.unwrapKey(
    "raw",
    wrapped,
    sharedAesKey,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    false,         // non-extractable once unwrapped
    ["decrypt"]
  );
}

/** Serialize a public key to JWK string for API upload. */
export async function exportPublicKeyJwk(publicKey: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", publicKey);
}
