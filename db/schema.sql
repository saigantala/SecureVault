-- db/schema.sql — updated with email column (Phase 6)
-- Run: psql -d securevault -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address  TEXT UNIQUE NOT NULL,
    role            TEXT NOT NULL DEFAULT 'user',
    email           TEXT,                          -- optional, for anomaly alerts
    email_verified  BOOLEAN DEFAULT false,
    public_key      JSONB,                         -- P-256 ECDH public key (JWK)
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
CREATE INDEX IF NOT EXISTS idx_files_owner
    ON files(owner_id) WHERE deleted_at IS NULL;

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
CREATE INDEX IF NOT EXISTS idx_access_grants_grantee
    ON access_grants(granted_to) WHERE revoked_at IS NULL;

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

