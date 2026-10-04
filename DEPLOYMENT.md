# SecureVault — Production Deployment Guide

This guide covers deploying SecureVault to production with **Vercel / Render / Fly.io**, managed **PostgreSQL**, and S3-compatible storage (**AWS S3 / Cloudflare R2**).

---

## 1. Architecture Overview

```
[ User Browser ]
  │
  ├── 1. Connects wallet & authenticates via SIWE (Next.js Edge Middleware)
  ├── 2. Encrypts files in-browser (Web Crypto AES-256-GCM + HKDF)
  ├── 3. Streams ciphertext to /api/files (Next.js server-side streaming)
  └── 4. Decrypts downloads client-side via presigned S3/R2 direct links
        │
        ├── [ Cloudflare WAF ] (Rate limiting, SQLi/XSS filtering)
        │
        ├── [ Next.js App Router ] (Hosted on Vercel, Render, or Fly.io)
        │
        ├── [ Managed Postgres ] (Neon, Supabase, or AWS RDS)
        │     - Users, SIWE nonces, access_grants, audit_log, file metadata
        │
        └── [ Private Object Storage ] (Cloudflare R2 or AWS S3)
              - Pure ciphertext binary blobs only (Zero-Knowledge)
```

---

## 2. Infrastructure Setup

### A. Object Storage (Cloudflare R2 or AWS S3)

1. **Create Private Bucket**:
   - Bucket Name: `securevault-files`
   - **Public Access**: Fully Blocked. All downloads use short-lived presigned URLs.

2. **CORS Configuration**:
   Because client browsers fetch ciphertext directly from S3/R2 presigned URLs, configure CORS on your bucket:
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedOrigins": ["https://yourdomain.com", "http://localhost:3000"],
       "ExposeHeaders": ["ETag", "Content-Length"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. **API Keys**:
   - Generate Access Key ID & Secret Access Key with `PutObject`, `GetObject`, and `DeleteObject` permissions on `securevault-files`.

---

### B. Managed PostgreSQL

Compatible with **Neon**, **Supabase**, **Render Postgres**, or **AWS RDS**:

1. Ensure the `pgcrypto` extension is permitted (it is standard on all modern providers).
2. Grab the connection string:
   ```
   DATABASE_URL=postgresql://user:password@ep-host.provider.com:5432/securevault?sslmode=require
   ```
3. Run the migration script locally or in CI:
   ```bash
   DATABASE_URL="postgresql://..." npm run db:migrate
   ```
4. Optional: Seed an initial Admin wallet address:
   ```bash
   SEED_ADMIN_WALLET="0xYourAdminWalletAddress" DATABASE_URL="postgresql://..." npm run db:migrate
   ```

---

## 3. Environment Variables Reference

| Variable | Description | Example / How to generate |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `JWT_SECRET` | 64+ byte secret for signing session cookies | Generate: `openssl rand -base64 64` |
| `NEXT_PUBLIC_WALLETCONNECT_ID` | WalletConnect Cloud Project ID | Obtain at https://cloud.walletconnect.com |
| `NEXT_PUBLIC_APP_URL` | Public production URL of your app | `https://vault.yourdomain.com` |
| `S3_ENDPOINT` | Custom endpoint for R2/MinIO (omit for AWS) | `https://<account_id>.r2.cloudflarestorage.com` |
| `S3_REGION` | S3 Region | `us-east-1` (or `auto` for Cloudflare R2) |
| `S3_BUCKET` | S3 bucket name | `securevault-files` |
| `S3_ACCESS_KEY_ID` | S3 API access key | `AKIA...` or R2 Token ID |
| `S3_SECRET_ACCESS_KEY` | S3 API secret key | Secret string |
| `SMTP_HOST` | SMTP server for anomaly alerts | `smtp.resend.com` or `smtp.sendgrid.net` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | `apikey` or `postmaster@...` |
| `SMTP_PASS` | SMTP password / API token | `re_...` |
| `ALERT_FROM_EMAIL` | Sender email address for alerts | `alerts@yourdomain.com` |

---

## 4. Deployment Options

### Option A: Vercel (Recommended)

1. Push your repository to GitHub or GitLab.
2. In the Vercel Dashboard, click **Add New Project** and import the repository.
3. Configure the Root Directory as `securevault` (if in a subdirectory).
4. Add all Environment Variables from section 3 above.
5. In **Build & Development Settings**, keep default Next.js settings:
   - Build Command: `next build`
   - Output Directory: `.next`
6. Click **Deploy**.
7. Run migrations via CI or one-off:
   ```bash
   npx tsx db/migrate.ts
   ```

### Option B: Render

1. Create a **New Web Service** connected to your repository.
2. **Environment**: Node
3. **Build Command**: `npm install && npm run build`
4. **Start Command**: `npm run start`
5. Under **Advanced Settings**, add the environment variables.
6. Connect a **Render PostgreSQL** instance and link `DATABASE_URL`.

### Option C: Fly.io

1. Create a `Dockerfile`:
   ```dockerfile
   FROM node:20-alpine AS builder
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci
   COPY . .
   RUN npm run build

   FROM node:20-alpine AS runner
   WORKDIR /app
   ENV NODE_ENV=production
   COPY --from=builder /app/public ./public
   COPY --from=builder /app/.next ./.next
   COPY --from=builder /app/node_modules ./node_modules
   COPY --from=builder /app/package.json ./package.json
   EXPOSE 3000
   CMD ["npm", "start"]
   ```
2. Deploy with Fly CLI:
   ```bash
   fly launch
   fly secrets set JWT_SECRET="openssl-generated-value" DATABASE_URL="..." ...
   fly deploy
   ```

---

## 5. Post-Deployment Verification Checklist

- [ ] **HSTS & Security Headers**: Test your live domain at [securityheaders.com](https://securityheaders.com) — aim for **A+**.
- [ ] **SIWE Login**: Connect MetaMask/Rabby and verify signature succeeds, setting httpOnly session cookie.
- [ ] **Zero-Knowledge Storage Verification**:
  1. Upload a text or PDF file via `/app/upload`.
  2. Inspect the S3/R2 bucket object — download it directly and inspect with a hex editor. Confirm it is unreadable ciphertext.
  3. Inspect PostgreSQL: `SELECT encrypted_name, ciphertext_hash FROM file_versions;` — confirm no plaintext filename or data exists.
- [ ] **Anomaly Detection**:
  1. Sign in from a second IP or mobile network.
  2. Confirm an `anomaly` row was inserted into `audit_log`.
  3. Confirm the security alert email arrives (if configured).
- [ ] **Access Grants**:
  1. Test "Share with admin" or share with a second wallet address.
  2. Confirm grantee can unwrap and download the file.
  3. Confirm admin cannot see unshared files.
