# 🔒 SecureVault — Zero-Knowledge Encrypted Web3 File Storage

SecureVault is an enterprise-grade, zero-knowledge encrypted cloud storage application built with **Next.js 16 (App Router)**, **TypeScript**, **PostgreSQL**, and **Wagmi v2**. 

Files are encrypted on the client side using **AES-256-GCM** before uploading. The server and storage provider never see plaintext file content, filenames, or raw cryptographic keys.

---

## 🚀 Features

- **Zero-Knowledge Architecture**: Files are encrypted with AES-256-GCM in the browser via Web Crypto API. Encryption keys are derived using HKDF from a cryptographic wallet signature (`signMessage`).
- **Web3 Authentication (SIWE)**: Strictly authenticated using EIP-4361 (Sign-In with Ethereum). Compatible with:
  - 🦊 **MetaMask** (direct browser extension & mobile app)
  - 🔗 **WalletConnect** (mobile QR code scanning across 300+ wallets)
- **Email Verification & Security Notifications**:
  - 6-digit OTP email verification (`POST /api/auth/email/send-code` & `verify-code`).
  - Real-time login security alerts dispatched via Gmail SMTP / custom SMTP on every sign-in.
  - Anomaly detection alerts triggered when a sign-in occurs from a new IP address or device.
- **Client-Side Key Exchange (ECDH P-256)**:
  - Users generate local ECDH key pairs to share encrypted files peer-to-peer.
  - File encryption keys are wrapped using AES-KeyWrap and shared secrets derived via ECDH.
- **Hybrid Storage Driver**:
  - Supports zero-config **local ciphertext storage** (`STORAGE_DRIVER=local`) or cloud object storage (**AWS S3 / Cloudflare R2 / Backblaze B2**).
- **Security Audit Log**:
  - Immutable event logs recorded in PostgreSQL for every login, upload, download, share grant, and anomaly detection.

---

## 🛠 Tech Stack

- **Framework**: Next.js 16 (App Router & Turbopack)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database**: PostgreSQL (pg driver with raw parameterized queries & migrations)
- **Web3**: Wagmi v2, Viem, SIWE
- **Cryptography**: Web Crypto API (SubtleCrypto: AES-GCM, HKDF, ECDH, AES-KW, SHA-256)
- **Email Delivery**: Nodemailer (Gmail SMTP & Ethereal test inbox fallback)

---

## ⚡ Quick Start

### 1. Prerequisites
- Node.js 20+ installed
- PostgreSQL database running (local or cloud like Neon / Supabase)

### 2. Clone and Install
```bash
git clone https://github.com/saigantala/SecureVault.git
cd SecureVault
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Fill in your database URL and settings:
```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/securevault

# Auth
JWT_SECRET=your_super_secret_jwt_random_string_32_bytes_min

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_WALLETCONNECT_ID=3fcc6bba2d1de962d911bb5b5c3dba68

# Storage (use 'local' for local disk or configure S3/R2)
STORAGE_DRIVER=local

# Outgoing Email Notifications (Gmail SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-google-app-password
ALERT_FROM_EMAIL="SecureVault Security <your-email@gmail.com>"
```

### 4. Run Database Migrations
```bash
npx tsx db/migrate.ts
```

### 5. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📂 Project Structure

```text
├── app/
│   ├── api/
│   │   ├── auth/          # Nonce, SIWE verify, and Email OTP routes
│   │   ├── files/         # File upload, list, download, and delete
│   │   ├── grants/        # Encrypted file sharing & key-wrapping
│   │   ├── security/      # Audit log & security queries
│   │   └── users/         # Public key JWK registry
│   ├── app/
│   │   ├── dashboard/     # Main vault dashboard
│   │   ├── files/         # File management & sharing
│   │   ├── upload/        # Client-side encryption & upload
│   │   ├── security/      # Security audit log UI
│   │   └── profile/       # Wallet identity & email verification
│   └── login/             # Web3 wallet connection screen
├── components/            # Reusable UI components & modals
├── db/                    # PostgreSQL schema & migration scripts
├── hooks/                 # Custom React hooks (useFileKey, useUpload)
├── lib/                   # Core crypto, database, rate limiting, and email utilities
└── public/                # Static assets & icons
```

---

## 📄 License
MIT License. Created by [saigantala](https://github.com/saigantala).
