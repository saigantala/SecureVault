// lib/vaultStore.ts
// Universal Fault-Tolerant Hybrid Data Layer.
// Seamlessly operates with PostgreSQL when available, and automatically falls back
// to a local persistent JSON metadata store (.storage/vault_meta.json) if the database
// is offline, cold-starting, or misconfigured.

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { db, ensureDatabaseSchema } from "@/lib/db";

const STORAGE_DIR = path.resolve(process.cwd(), ".storage");
const META_FILE = path.resolve(STORAGE_DIR, "vault_meta.json");

export interface StoredUser {
  id: string;
  wallet_address: string;
  role: string;
  email: string | null;
  email_verified: boolean;
  public_key?: Record<string, unknown> | null;
  created_at: string;
}

export interface StoredFileVersion {
  version_no: number;
  ciphertext_hash: string;
  prev_hash: string | null;
  s3_pointer: string;
  size_bytes: number;
  iv: string;
  created_at: string;
}

export interface StoredFile {
  file_id: string;
  owner_id: string;
  owner_address: string;
  encrypted_name: string;
  mime_type: string | null;
  created_at: string;
  deleted_at: string | null;
  versions: StoredFileVersion[];
}

export interface StoredAuditEvent {
  id: string;
  user_id: string | null;
  wallet_address: string;
  event_type: string;
  ip_address: string;
  user_agent: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface VaultData {
  users: StoredUser[];
  files: StoredFile[];
  audit_logs: StoredAuditEvent[];
}

let memoryVault: VaultData | null = null;

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
}

function loadVaultData(): VaultData {
  if (memoryVault) return memoryVault;

  ensureDir(STORAGE_DIR);
  if (fs.existsSync(META_FILE)) {
    try {
      const raw = fs.readFileSync(META_FILE, "utf8");
      memoryVault = JSON.parse(raw);
      return memoryVault!;
    } catch {
      // ignore
    }
  }

  memoryVault = { users: [], files: [], audit_logs: [] };
  return memoryVault;
}

function persistVaultData() {
  if (!memoryVault) return;
  try {
    ensureDir(STORAGE_DIR);
    fs.writeFileSync(META_FILE, JSON.stringify(memoryVault, null, 2), "utf8");
  } catch (err) {
    console.warn("[vaultStore] Failed to write metadata file:", (err as Error).message);
  }
}

// ── 1. Users ──────────────────────────────────────────────────────────────────
export async function upsertUser(
  walletAddress: string,
  role = "user",
  email?: string
): Promise<StoredUser> {
  const normAddr = walletAddress.toLowerCase();
  const now = new Date().toISOString();

  // Try PostgreSQL
  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabaseSchema();
      const res = await db.query<{
        id: string;
        wallet_address: string;
        role: string;
        email: string | null;
        email_verified: boolean | null;
        public_key: Record<string, unknown> | null;
        created_at: string;
      }>(
        `INSERT INTO users (wallet_address, role, email)
         VALUES ($1, $2, $3)
         ON CONFLICT (wallet_address)
         DO UPDATE SET
           role = COALESCE(users.role, EXCLUDED.role),
           email = COALESCE(EXCLUDED.email, users.email)
         RETURNING id, wallet_address, role, email, email_verified, public_key, created_at`,
        [normAddr, role, email ?? null]
      );
      if (res.rows[0]) {
        const u = res.rows[0];
        const userObj: StoredUser = {
          id: u.id,
          wallet_address: u.wallet_address,
          role: u.role,
          email: u.email,
          email_verified: Boolean(u.email_verified),
          public_key: u.public_key,
          created_at: u.created_at,
        };
        // Update local cache
        const data = loadVaultData();
        const idx = data.users.findIndex((x) => x.wallet_address === normAddr);
        if (idx >= 0) data.users[idx] = userObj;
        else data.users.push(userObj);
        persistVaultData();
        return userObj;
      }
    } catch (err) {
      console.warn("[vaultStore] DB upsertUser fallback:", (err as Error).message);
    }
  }

  // Local fallback
  const data = loadVaultData();
  let user = data.users.find((u) => u.wallet_address === normAddr);
  if (!user) {
    user = {
      id: randomUUID(),
      wallet_address: normAddr,
      role,
      email: email ?? null,
      email_verified: false,
      created_at: now,
    };
    data.users.push(user);
  } else if (email) {
    user.email = email;
  }
  persistVaultData();
  return user;
}

export async function getUser(identifier: string): Promise<StoredUser | null> {
  const norm = identifier.toLowerCase();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabaseSchema();
      const queryText = isUuid
        ? `SELECT id, wallet_address, role, email, email_verified, public_key, created_at FROM users WHERE id = $1`
        : `SELECT id, wallet_address, role, email, email_verified, public_key, created_at FROM users WHERE lower(wallet_address) = $1`;
      const res = await db.query<{
        id: string;
        wallet_address: string;
        role: string;
        email: string | null;
        email_verified: boolean | null;
        public_key: Record<string, unknown> | null;
        created_at: string;
      }>(queryText, [norm]);
      if (res.rows[0]) {
        const u = res.rows[0];
        return {
          id: u.id,
          wallet_address: u.wallet_address,
          role: u.role,
          email: u.email,
          email_verified: Boolean(u.email_verified),
          public_key: u.public_key,
          created_at: u.created_at,
        };
      }
    } catch {}
  }

  // Local fallback
  const data = loadVaultData();
  return data.users.find((u) => (isUuid ? u.id === identifier : u.wallet_address === norm)) ?? null;
}

export async function getUserPublicKey(walletAddress: string): Promise<Record<string, unknown> | null> {
  const normAddr = walletAddress.toLowerCase();
  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabaseSchema();
      const res = await db.query<{ public_key: Record<string, unknown> | null }>(
        `SELECT public_key FROM users WHERE lower(wallet_address) = $1`,
        [normAddr]
      );
      if (res.rows[0]?.public_key) return res.rows[0].public_key;
    } catch {}
  }

  const data = loadVaultData();
  const user = data.users.find((u) => u.wallet_address === normAddr);
  return user?.public_key ?? null;
}

export async function updateUserPublicKey(walletAddress: string, publicKey: Record<string, unknown>): Promise<void> {
  const normAddr = walletAddress.toLowerCase();
  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabaseSchema();
      await db.query(
        `UPDATE users SET public_key = $1 WHERE lower(wallet_address) = $2`,
        [JSON.stringify(publicKey), normAddr]
      );
    } catch {}
  }

  const data = loadVaultData();
  let user = data.users.find((u) => u.wallet_address === normAddr);
  if (!user) {
    user = await upsertUser(normAddr);
  }
  user.public_key = publicKey;
  persistVaultData();
}

// ── 2. Files ──────────────────────────────────────────────────────────────────
export interface SaveFileParams {
  ownerId: string;
  ownerAddress: string;
  encryptedName: string;
  mimeType: string | null;
  ciphertextHash: string;
  prevHash: string | null;
  s3Key: string;
  size: number;
  iv: string;
  fileId?: string | null;
  existingFileId?: string | null;
}

export async function saveFile(params: SaveFileParams): Promise<{ fileId: string; versionNo: number }> {
  const {
    ownerId,
    ownerAddress,
    encryptedName,
    mimeType,
    ciphertextHash,
    prevHash,
    s3Key,
    size,
    iv,
    fileId: explicitFileId,
    existingFileId,
  } = params;
  const now = new Date().toISOString();
  const normAddress = ownerAddress.toLowerCase();
  const targetFileId = existingFileId || explicitFileId || randomUUID();

  // Try PostgreSQL first
  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabaseSchema();
      // Ensure user exists in PostgreSQL
      const dbUser = await upsertUser(normAddress);
      const validOwnerId = dbUser.id;

      let versionNo = 1;

      if (existingFileId) {
        const versionRow = await db.query<{ max: string }>(
          `SELECT MAX(version_no) as max FROM file_versions WHERE file_id = $1`,
          [existingFileId]
        );
        versionNo = parseInt(versionRow.rows[0]?.max ?? "0", 10) + 1;
      } else {
        await db.query(
          `INSERT INTO files (id, owner_id, encrypted_name, mime_type)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING`,
          [targetFileId, validOwnerId, encryptedName, mimeType]
        );
      }

      await db.query(
        `INSERT INTO file_versions (file_id, version_no, ciphertext_hash, prev_hash, s3_pointer, size_bytes, iv)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [targetFileId, versionNo, ciphertextHash, prevHash, s3Key, size, iv]
      );

      // Sync to local fallback store as well
      syncLocalFile(targetFileId, validOwnerId, normAddress, encryptedName, mimeType, now, {
        version_no: versionNo,
        ciphertext_hash: ciphertextHash,
        prev_hash: prevHash,
        s3_pointer: s3Key,
        size_bytes: size,
        iv,
        created_at: now,
      });

      return { fileId: targetFileId, versionNo };
    } catch (err) {
      console.warn("[vaultStore] DB saveFile fallback:", (err as Error).message);
    }
  }

  // Local fallback
  const data = loadVaultData();
  let versionNo = 1;

  if (existingFileId) {
    const existing = data.files.find((f) => f.file_id === existingFileId);
    if (existing) {
      versionNo = existing.versions.length + 1;
      existing.versions.push({
        version_no: versionNo,
        ciphertext_hash: ciphertextHash,
        prev_hash: prevHash,
        s3_pointer: s3Key,
        size_bytes: size,
        iv,
        created_at: now,
      });
    }
  } else {
    data.files.push({
      file_id: targetFileId,
      owner_id: ownerId,
      owner_address: normAddress,
      encrypted_name: encryptedName,
      mime_type: mimeType,
      created_at: now,
      deleted_at: null,
      versions: [
        {
          version_no: 1,
          ciphertext_hash: ciphertextHash,
          prev_hash: prevHash,
          s3_pointer: s3Key,
          size_bytes: size,
          iv,
          created_at: now,
        },
      ],
    });
  }

  persistVaultData();
  return { fileId: targetFileId, versionNo };
}

function syncLocalFile(
  fileId: string,
  ownerId: string,
  ownerAddress: string,
  encryptedName: string,
  mimeType: string | null,
  createdAt: string,
  version: StoredFileVersion
) {
  const data = loadVaultData();
  let file = data.files.find((f) => f.file_id === fileId);
  if (!file) {
    file = {
      file_id: fileId,
      owner_id: ownerId,
      owner_address: ownerAddress,
      encrypted_name: encryptedName,
      mime_type: mimeType,
      created_at: createdAt,
      deleted_at: null,
      versions: [version],
    };
    data.files.push(file);
  } else {
    const vIdx = file.versions.findIndex((v) => v.version_no === version.version_no);
    if (vIdx >= 0) file.versions[vIdx] = version;
    else file.versions.push(version);
  }
  persistVaultData();
}

export async function listUserFiles(ownerId: string, ownerAddress: string) {
  const normAddr = ownerAddress.toLowerCase();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId);

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabaseSchema();
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
           f.id AS file_id,
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
         JOIN users u ON u.id = f.owner_id
         WHERE (f.owner_id = $1 OR lower(u.wallet_address) = $2)
           AND f.deleted_at IS NULL
           AND fv.version_no = (
             SELECT MAX(v2.version_no) FROM file_versions v2 WHERE v2.file_id = f.id
           )
         ORDER BY f.created_at DESC`,
        [isUuid ? ownerId : "00000000-0000-0000-0000-000000000000", normAddr]
      );
      if (rows.rows.length > 0) {
        return rows.rows;
      }
    } catch (err) {
      console.warn("[vaultStore] DB listUserFiles fallback:", (err as Error).message);
    }
  }

  // Local fallback
  const data = loadVaultData();
  const files = data.files.filter(
    (f) =>
      !f.deleted_at &&
      (f.owner_address === normAddr || (isUuid && f.owner_id === ownerId))
  );

  return files.map((f) => {
    const latestVersion = f.versions[f.versions.length - 1];
    return {
      file_id: f.file_id,
      encrypted_name: f.encrypted_name,
      mime_type: f.mime_type,
      created_at: f.created_at,
      version_no: latestVersion?.version_no ?? 1,
      ciphertext_hash: latestVersion?.ciphertext_hash ?? "",
      s3_pointer: latestVersion?.s3_pointer ?? "",
      size_bytes: latestVersion?.size_bytes ?? 0,
      iv: latestVersion?.iv ?? "",
      prev_hash: latestVersion?.prev_hash ?? null,
    };
  });
}

export async function getFileDownloadMeta(
  fileId: string,
  ownerId: string,
  ownerAddress: string,
  versionNo?: number
) {
  const normAddr = ownerAddress.toLowerCase();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId);

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabaseSchema();
      const versionFilter = versionNo
        ? `AND fv.version_no = ${versionNo}`
        : `AND fv.version_no = (SELECT MAX(v2.version_no) FROM file_versions v2 WHERE v2.file_id = f.id)`;

      const row = await db.query<{
        s3_pointer: string;
        iv: string;
        ciphertext_hash: string;
        version_no: number;
        size_bytes: number;
      }>(
        `SELECT fv.s3_pointer, fv.iv, fv.ciphertext_hash, fv.version_no, fv.size_bytes
         FROM files f
         JOIN file_versions fv ON fv.file_id = f.id
         JOIN users u ON u.id = f.owner_id
         WHERE f.id = $1
           AND (f.owner_id = $2 OR lower(u.wallet_address) = $3)
           AND f.deleted_at IS NULL
           ${versionFilter}
         LIMIT 1`,
        [fileId, isUuid ? ownerId : "00000000-0000-0000-0000-000000000000", normAddr]
      );
      if (row.rows[0]) return row.rows[0];
    } catch {}
  }

  // Local fallback
  const data = loadVaultData();
  const file = data.files.find(
    (f) =>
      f.file_id === fileId &&
      !f.deleted_at &&
      (f.owner_address === normAddr || (isUuid && f.owner_id === ownerId))
  );

  if (!file) return null;
  const version = versionNo
    ? file.versions.find((v) => v.version_no === versionNo)
    : file.versions[file.versions.length - 1];

  if (!version) return null;

  return {
    s3_pointer: version.s3_pointer,
    iv: version.iv,
    ciphertext_hash: version.ciphertext_hash,
    version_no: version.version_no,
    size_bytes: version.size_bytes,
  };
}

export async function getFileVersions(fileId: string, ownerId: string, ownerAddress: string) {
  const normAddr = ownerAddress.toLowerCase();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId);

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabaseSchema();
      const rows = await db.query<{
        id: string;
        version_no: number;
        ciphertext_hash: string;
        prev_hash: string | null;
        s3_pointer: string;
        size_bytes: number;
        iv: string;
        onchain_tx_hash: string | null;
        created_at: string;
      }>(
        `SELECT fv.id, fv.version_no, fv.ciphertext_hash, fv.prev_hash,
                fv.s3_pointer, fv.size_bytes, fv.iv, fv.onchain_tx_hash, fv.created_at
         FROM file_versions fv
         JOIN files f ON f.id = fv.file_id
         JOIN users u ON u.id = f.owner_id
         WHERE f.id = $1
           AND (f.owner_id = $2 OR lower(u.wallet_address) = $3)
           AND f.deleted_at IS NULL
         ORDER BY fv.version_no DESC`,
        [fileId, isUuid ? ownerId : "00000000-0000-0000-0000-000000000000", normAddr]
      );
      if (rows.rows.length > 0) return rows.rows;
    } catch {}
  }

  // Local fallback
  const data = loadVaultData();
  const file = data.files.find(
    (f) =>
      f.file_id === fileId &&
      !f.deleted_at &&
      (f.owner_address === normAddr || (isUuid && f.owner_id === ownerId))
  );

  if (!file) return [];
  return [...file.versions]
    .sort((a, b) => b.version_no - a.version_no)
    .map((v) => ({
      id: `${file.file_id}-v${v.version_no}`,
      version_no: v.version_no,
      ciphertext_hash: v.ciphertext_hash,
      prev_hash: v.prev_hash,
      s3_pointer: v.s3_pointer,
      size_bytes: v.size_bytes,
      iv: v.iv,
      onchain_tx_hash: null,
      created_at: v.created_at,
    }));
}

export async function deleteVaultFile(
  fileId: string,
  ownerId: string,
  ownerAddress: string
): Promise<boolean> {
  const normAddr = ownerAddress.toLowerCase();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId);
  const now = new Date().toISOString();

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabaseSchema();
      await db.query(
        `UPDATE files SET deleted_at = now()
         WHERE id = $1
           AND (owner_id = $2 OR owner_id IN (SELECT id FROM users WHERE lower(wallet_address) = $3))
           AND deleted_at IS NULL`,
        [fileId, isUuid ? ownerId : "00000000-0000-0000-0000-000000000000", normAddr]
      );
    } catch {}
  }

  // Local fallback
  const data = loadVaultData();
  const file = data.files.find(
    (f) =>
      f.file_id === fileId &&
      (f.owner_address === normAddr || (isUuid && f.owner_id === ownerId))
  );

  if (file) {
    file.deleted_at = now;
    persistVaultData();
    return true;
  }
  return false;
}

// ── 3. Audit Logs ─────────────────────────────────────────────────────────────
export async function recordAuditEvent(event: {
  userId: string | null;
  walletAddress: string;
  eventType: string;
  ip: string;
  userAgent: string;
  metadata?: Record<string, unknown> | null;
}) {
  const { userId, walletAddress, eventType, ip, userAgent, metadata } = event;
  const now = new Date().toISOString();
  const isUuid = userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabaseSchema();
      await db.query(
        `INSERT INTO audit_log (user_id, event_type, ip_address, user_agent, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          isUuid ? userId : null,
          eventType,
          ip || "127.0.0.1",
          userAgent,
          JSON.stringify({ ...(metadata ?? {}), address: walletAddress }),
        ]
      );
    } catch {}
  }

  const data = loadVaultData();
  data.audit_logs.unshift({
    id: randomUUID(),
    user_id: userId,
    wallet_address: walletAddress.toLowerCase(),
    event_type: eventType,
    ip_address: ip,
    user_agent: userAgent,
    metadata: metadata ?? null,
    created_at: now,
  });
  if (data.audit_logs.length > 500) data.audit_logs.pop();
  persistVaultData();
}

export async function getAuditEvents(walletAddress: string, limit = 50, offset = 0) {
  const normAddr = walletAddress.toLowerCase();

  if (process.env.DATABASE_URL) {
    try {
      await ensureDatabaseSchema();
      const rows = await db.query<{
        id: string;
        event_type: string;
        ip_address: string | null;
        user_agent: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }>(
        `SELECT id, event_type, ip_address::text, user_agent, metadata, created_at
         FROM audit_log
         WHERE lower(metadata->>'address') = $1
            OR user_id IN (SELECT id FROM users WHERE lower(wallet_address) = $1)
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [normAddr, limit, offset]
      );
      if (rows.rows.length > 0) {
        return { events: rows.rows, total: rows.rows.length };
      }
    } catch {}
  }

  const data = loadVaultData();
  const matched = data.audit_logs.filter((a) => a.wallet_address === normAddr);
  return {
    events: matched.slice(offset, offset + limit),
    total: matched.length,
  };
}

// ── 4. Dashboard Stats ────────────────────────────────────────────────────────
export async function getDashboardStats(ownerId: string, ownerAddress: string) {
  let dbConnected = false;
  if (process.env.DATABASE_URL) {
    try {
      await db.query("SELECT 1");
      dbConnected = true;
    } catch {}
  }
  const files = await listUserFiles(ownerId, ownerAddress);
  const fileCount = files.length;
  const storageBytes = files.reduce((acc, f) => acc + (f.size_bytes || 0), 0);
  return { fileCount, storageBytes, receivedGrantsCount: 0, dbConnected };
}
