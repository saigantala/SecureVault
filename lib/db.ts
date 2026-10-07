// lib/db.ts
// PostgreSQL connection pool — server-side only.
// Includes automated schema self-initialization and memory-fallback nonce store.

import { Pool } from "pg";

declare global {
  // Prevent creating multiple pools in Next.js dev hot-reload
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var _memoryNonces: Map<string, MemoryNonce> | undefined;
}

export interface MemoryNonce {
  nonce: string;
  expiresAt: number;
  used: boolean;
}

export const memoryNonces: Map<string, MemoryNonce> =
  global._memoryNonces ??= new Map<string, MemoryNonce>();

export function storeMemoryNonce(address: string, nonce: string, ttlMs = 5 * 60_000) {
  const norm = address.toLowerCase();
  memoryNonces.set(`${norm}:${nonce}`, {
    nonce,
    expiresAt: Date.now() + ttlMs,
    used: false,
  });

  // Prune expired nonces
  const now = Date.now();
  for (const [k, v] of memoryNonces.entries()) {
    if (v.expiresAt < now || v.used) {
      memoryNonces.delete(k);
    }
  }
}

export function verifyMemoryNonce(address: string, nonce: string): boolean {
  const norm = address.toLowerCase();
  const key = `${norm}:${nonce}`;
  const entry = memoryNonces.get(key);
  if (entry && !entry.used && entry.expiresAt > Date.now()) {
    entry.used = true;
    memoryNonces.delete(key);
    return true;
  }
  return false;
}

export function isDatabaseConfigured(): boolean {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return false;
  // If running in production on Render/cloud and DATABASE_URL points to localhost,
  // do not treat as configured to prevent ECONNREFUSED socket errors
  if (
    process.env.NODE_ENV === "production" &&
    (rawUrl.includes("localhost") || rawUrl.includes("127.0.0.1"))
  ) {
    return false;
  }
  return true;
}

function getCleanDatabaseUrl(): string | undefined {
  if (!isDatabaseConfigured()) return undefined;
  const rawUrl = process.env.DATABASE_URL!;
  try {
    const parsed = new URL(rawUrl);
    // Remove sslmode=require from query params so pg respects ssl: { rejectUnauthorized: false }
    parsed.searchParams.delete("sslmode");
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function createPool() {
  const rawUrl = process.env.DATABASE_URL;
  const isLocal =
    !rawUrl ||
    rawUrl.includes("localhost") ||
    rawUrl.includes("127.0.0.1");

  return new Pool({
    connectionString: getCleanDatabaseUrl(),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
}

export const db: Pool =
  process.env.NODE_ENV === "production"
    ? createPool()
    : (global._pgPool ??= createPool());

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[]
) {
  return db.query<T>(text, values);
}

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address  TEXT UNIQUE NOT NULL,
    role            TEXT NOT NULL DEFAULT 'user',
    email           TEXT,
    email_verified  BOOLEAN DEFAULT false,
    public_key      JSONB,
    created_at      TIMESTAMPTZ DEFAULT now(),
    last_login_at   TIMESTAMPTZ,
    last_ip         INET,
    last_user_agent TEXT,
    mfa_enabled     BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS auth_nonces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address  TEXT NOT NULL,
    nonce           TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    used            BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_nonces_address ON auth_nonces(wallet_address);

CREATE TABLE IF NOT EXISTS files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID REFERENCES users(id) ON DELETE CASCADE,
    encrypted_name  TEXT NOT NULL,
    mime_type       TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS file_versions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id           UUID REFERENCES files(id) ON DELETE CASCADE,
    version_no        INT NOT NULL,
    ciphertext_hash   TEXT NOT NULL,
    prev_hash         TEXT,
    s3_pointer        TEXT NOT NULL,
    size_bytes        BIGINT,
    iv                TEXT NOT NULL,
    onchain_tx_hash   TEXT,
    created_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE(file_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_file_versions_file ON file_versions(file_id);

CREATE TABLE IF NOT EXISTS access_grants (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id           UUID REFERENCES files(id) ON DELETE CASCADE,
    granted_by        UUID REFERENCES users(id),
    granted_to        UUID REFERENCES users(id),
    wrapped_key       TEXT NOT NULL,
    expires_at        TIMESTAMPTZ,
    revoked_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_access_grants_file    ON access_grants(file_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_grantee ON access_grants(granted_to) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    event_type      TEXT NOT NULL,
    ip_address      INET,
    user_agent      TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event   ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS email_verifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    code            TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    used            BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_verif_user ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verif_code ON email_verifications(email, code);
`;

let schemaPromise: Promise<void> | null = null;

export async function ensureDatabaseSchema(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    try {
      const check = await db.query(
        "SELECT to_regclass('public.auth_nonces') as tbl"
      );
      if (!check.rows[0]?.tbl) {
        console.log("[db] Tables not found. Automatically applying database schema...");
        await db.query(SCHEMA_SQL);
        console.log("[db] Database schema applied successfully!");
      }
    } catch (err) {
      console.warn("[db] Auto-migration check encountered an error:", (err as Error).message);
    }
  })();

  return schemaPromise;
}
