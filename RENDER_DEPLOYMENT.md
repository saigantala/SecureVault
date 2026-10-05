# Deploying SecureVault on Render

This guide walks you through deploying **SecureVault** on [Render](https://render.com) using either the **Automated Blueprint (Recommended)** or **Manual Setup**.

---

## Prerequisites
1. A GitHub account with access to your repository: [github.com/saigantala/SecureVault](https://github.com/saigantala/SecureVault).
2. A free [Render account](https://dashboard.render.com).
3. (Optional) Your Gmail App Password if you want live mobile email notifications.

---

## Method 1: 1-Click Blueprint Deployment (Recommended)

Because this repository includes a [`render.yaml`](./render.yaml) file, Render can configure both the **Next.js Web Service** and the **PostgreSQL Database** in one step.

### Step 1: Create a Blueprint Instance on Render
1. Log in to [dashboard.render.com](https://dashboard.render.com).
2. In the top-right corner, click **New +** and select **Blueprint**.
3. Connect your GitHub account and select the **`saigantala/SecureVault`** repository.
4. Render will detect the `render.yaml` file and display the two resources to create:
   - `securevault-web` (Web Service)
   - `securevault-db` (PostgreSQL Database)

### Step 2: Fill in the Environment Secrets
Render will ask you to supply values for the unsynced environment variables:

| Variable | Value / Description | Example |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_WALLETCONNECT_ID` | Project ID from [cloud.walletconnect.com](https://cloud.walletconnect.com) | *(Your Project ID)* |
| `SMTP_USER` | Your notification Gmail address | `saigantala7@gmail.com` |
| `SMTP_PASS` | 16-character Google App Password | `ugjqyqyoyirpwnmc` |
| `ALERT_FROM_EMAIL` | Sender address shown in emails | `saigantala7@gmail.com` |

*(Note: `DATABASE_URL`, `JWT_SECRET`, and `NEXT_PUBLIC_APP_URL` are generated and linked automatically by the Blueprint).*

### Step 3: Deploy
1. Click **Apply**.
2. Render will:
   - Provision the PostgreSQL database.
   - Run `npm install`.
   - Run `npm run db:migrate` (creates all tables, indexes, and extensions automatically).
   - Run `npm run build` (Turbopack production build).
   - Start your server with `npm run start`.
3. Your live application will be available at `https://securevault-web.onrender.com` (or your custom service name)!

---

## Method 2: Manual Dashboard Setup

If you prefer to configure the Web Service and Database manually:

### Step 1: Create a PostgreSQL Database
1. Go to [Render Dashboard](https://dashboard.render.com) -> **New +** -> **PostgreSQL**.
2. Settings:
   - **Name**: `securevault-db`
   - **Database**: `securevault`
   - **User**: `securevault`
   - **Plan**: `Free`
3. Click **Create Database**.
4. Once created, copy the **Internal Database URL** (e.g., `postgresql://securevault:...@dpg-...-a/securevault`).

### Step 2: Create the Web Service
1. Go to **New +** -> **Web Service**.
2. Connect repository: `saigantala/SecureVault`.
3. Settings:
   - **Name**: `securevault`
   - **Runtime**: `Node`
   - **Branch**: `main`
   - **Build Command**: `npm install && npm run db:migrate && npm run build`
   - **Start Command**: `npm run start`
   - **Plan**: `Free`

### Step 3: Add Environment Variables
Under **Environment Variables**, add:
- `NODE_ENV`: `production`
- `DATABASE_URL`: *(Paste the Internal Database URL from Step 1)*
- `JWT_SECRET`: *(Generate a 64-byte random string or use openssl rand -base64 64)*
- `NEXT_PUBLIC_WALLETCONNECT_ID`: *(Your WalletConnect ID)*
- `SMTP_HOST`: `smtp.gmail.com`
- `SMTP_PORT`: `465`
- `SMTP_USER`: `saigantala7@gmail.com`
- `SMTP_PASS`: `ugjqyqyoyirpwnmc`
- `ALERT_FROM_EMAIL`: `saigantala7@gmail.com`
- `NEXT_PUBLIC_APP_URL`: `https://<your-service-name>.onrender.com`

Click **Deploy Web Service**.

---

## Verification
Once deployed:
1. Open your Render web service URL (`https://your-app.onrender.com`).
2. Connect with **MetaMask** or **WalletConnect**.
3. Go to **Profile** -> click **Send Code** to test the 6-digit OTP delivery to your mobile device.
4. Go to **Security** to view the live audit log entries recorded by Render's PostgreSQL database!
