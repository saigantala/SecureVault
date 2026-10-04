-- db/add_public_key.sql
-- Phase 7: add public_key column for ECDH-based file sharing.
-- Run: psql -d securevault -f db/add_public_key.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS public_key JSONB;  -- P-256 ECDH public key as JWK
