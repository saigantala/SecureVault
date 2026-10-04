-- db/add_user_email.sql
-- Phase 6: add optional email column for anomaly alert notifications.
-- Run: psql -d securevault -f db/add_user_email.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT;
