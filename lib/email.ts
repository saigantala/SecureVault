// lib/email.ts
// Email notification & verification service using nodemailer.
// Supports:
//   1. Real SMTP (Gmail, Outlook, Resend, Brevo, SendGrid, custom SMTP)
//   2. Auto-generated live Ethereal email preview links when SMTP is not configured
//   3. Safe fallback logging so email failures never block auth or app features

import nodemailer, { type Transporter } from "nodemailer";
import dns from "dns";

// Ensure IPv4 resolution for outbound SMTP to prevent Windows IPv6 unreachable errors
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // ignore
}

let cachedTransporter: Transporter | null = null;
let isEthereal = false;

async function getTransporter(): Promise<Transporter> {
  if (cachedTransporter) return cachedTransporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    isEthereal = false;
    return cachedTransporter;
  }

  // If no SMTP configured, automatically create an on-the-fly test inbox with preview links
  try {
    const testAccount = await nodemailer.createTestAccount();
    cachedTransporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    isEthereal = true;
    console.log(`[email] Created temporary Ethereal test inbox: ${testAccount.user}`);
    return cachedTransporter;
  } catch (err) {
    console.warn("[email] Could not connect to test SMTP service:", (err as Error).message);
    // Dummy transporter fallback
    cachedTransporter = nodemailer.createTransport({
      streamTransport: true,
      newline: "unix",
      buffer: true,
    });
    return cachedTransporter;
  }
}

export interface VerificationEmailParams {
  toEmail: string;
  code: string;
  walletAddress?: string;
}

export interface LoginAlertParams {
  toEmail: string;
  walletAddress: string;
  ip: string;
  userAgent: string;
  timestamp: Date;
}

export interface AnomalyAlertParams {
  toEmail: string;
  walletAddress: string;
  reason: "new_ip" | "new_device";
  ip: string;
  userAgent: string;
  timestamp: Date;
}

export interface EmailResult {
  success: boolean;
  previewUrl?: string;
  code?: string;
}

/**
 * Send an email verification OTP code.
 */
export async function sendVerificationEmail(params: VerificationEmailParams): Promise<EmailResult> {
  const { toEmail, code, walletAddress } = params;
  const short = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : "Connected Wallet";

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
      <div style="background:#1e1b4b;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">🔒 SecureVault Email Verification</h1>
        <p style="color:#a5b4fc;margin:4px 0 0;font-size:13px">Zero-Knowledge Encrypted Storage</p>
      </div>
      <div style="background:#f8f8ff;padding:28px 32px;border:1px solid #e0e0ef;border-top:none">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111">
          Hello,
        </p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#374151">
          Please use the following 6-digit verification code to confirm your email address for wallet <strong>${short}</strong>:
        </p>

        <div style="text-align:center;margin:28px 0">
          <div style="display:inline-block;background:#312e81;color:#ffffff;font-size:32px;font-weight:800;letter-spacing:8px;padding:16px 36px;border-radius:12px;border:2px solid #4f46e5;font-family:monospace">
            ${code}
          </div>
          <p style="margin:10px 0 0;font-size:12px;color:#6b7280">
            This verification code expires in 15 minutes.
          </p>
        </div>

        <div style="background:#e0e7ff;padding:12px 16px;border-radius:8px;margin-bottom:20px;border-left:4px solid #4f46e5">
          <p style="margin:0;font-size:13px;color:#312e81">
            <strong>Security note:</strong> SecureVault will never ask for your private keys, seed phrase, or passwords.
          </p>
        </div>

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px"/>
        <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.4">
          If you did not request this verification code, you can safely ignore this email.
        </p>
      </div>
    </div>
  `;

  try {
    const transporter = await getTransporter();
    const fromAddress =
      process.env.ALERT_FROM_EMAIL ?? (process.env.SMTP_USER || "security@securevault.local");

    const info = await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject: `SecureVault: Your 6-Digit Email Verification Code (${code})`,
      html,
      text: `Your SecureVault email verification code is: ${code}. It expires in 15 minutes.`,
    });

    const previewUrl = isEthereal ? (nodemailer.getTestMessageUrl(info) as string) : undefined;
    if (previewUrl) {
      console.log(`[email] ✉️  Verification code sent to ${toEmail}: ${code}`);
      console.log(`[email] 🔗  View live email preview: ${previewUrl}`);
    } else {
      console.log(`[email] Verification email delivered to ${toEmail}`);
    }

    return { success: true, previewUrl, code };
  } catch (err) {
    console.error("[email] Failed to send verification email:", (err as Error).message);
    return { success: false, code };
  }
}

/**
 * Send a login notification email when a user logs in.
 * "you are login to this project through your mail"
 */
export async function sendLoginAlert(params: LoginAlertParams): Promise<EmailResult> {
  const { toEmail, walletAddress, ip, userAgent, timestamp } = params;
  const short = `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
      <div style="background:#1e1b4b;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700">🔒 SecureVault Login Notification</h1>
      </div>
      <div style="background:#f8f8ff;padding:24px 32px;border:1px solid #e0e0ef;border-top:none">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111">
          Hello,
        </p>
        <div style="background:#e0e7ff;padding:14px 18px;border-radius:8px;margin-bottom:18px;border-left:4px solid #4f46e5">
          <p style="margin:0;font-size:14px;font-weight:600;color:#312e81">
            You are logged in to this project (SecureVault) through your email and connected wallet.
          </p>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#333">
          <tr><td style="padding:6px 0;color:#666;width:140px">Wallet Address</td>
              <td style="font-family:monospace;font-weight:600">${walletAddress}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Email Destination</td>
              <td style="font-weight:500">${toEmail}</td></tr>
          <tr><td style="padding:6px 0;color:#666">IP Address</td>
              <td style="font-family:monospace">${ip}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Device / Browser</td>
              <td style="word-break:break-all;font-size:12px">${userAgent.slice(0, 120)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Login Time (UTC)</td>
              <td>${timestamp.toUTCString()}</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #ddd;margin:20px 0"/>
        <p style="margin:0;font-size:12px;color:#666;line-height:1.5">
          If you did not authorize this login, please disconnect your wallet and review your
          <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/app/security" style="color:#4f46e5;font-weight:600">Security Log</a>
          immediately.
        </p>
      </div>
    </div>
  `;

  try {
    const transporter = await getTransporter();
    const fromAddress =
      process.env.ALERT_FROM_EMAIL ?? (process.env.SMTP_USER || "security@securevault.local");

    const info = await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject: `SecureVault: You have logged in to SecureVault (${short})`,
      html,
      text: `You have logged in to SecureVault with wallet ${walletAddress} at ${timestamp.toUTCString()}`,
    });

    const previewUrl = isEthereal ? (nodemailer.getTestMessageUrl(info) as string) : undefined;
    if (previewUrl) {
      console.log(`[email] ✉️  Login alert sent to ${toEmail} for wallet ${short}`);
      console.log(`[email] 🔗  View live email preview: ${previewUrl}`);
    } else {
      console.log(`[email] Login notification delivered to ${toEmail}`);
    }

    return { success: true, previewUrl };
  } catch (err) {
    console.error("[email] Failed to send login alert:", (err as Error).message);
    return { success: false };
  }
}

/**
 * Send an anomaly alert email.
 */
export async function sendAnomalyAlert(params: AnomalyAlertParams): Promise<EmailResult> {
  const { toEmail, walletAddress, reason, ip, userAgent, timestamp } = params;

  const reasonLabel = reason === "new_ip" ? "new IP address" : "new device/browser";
  const short = `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;background:#fff;border-radius:12px;overflow:hidden">
      <div style="background:#1e1b4b;padding:24px 32px">
        <h1 style="color:#fff;margin:0;font-size:18px;font-weight:700">⚠️ SecureVault Security Alert</h1>
      </div>
      <div style="background:#f8f8ff;padding:24px 32px;border:1px solid #e0e0ef;border-top:none">
        <p style="margin:0 0 16px">
          We detected a sign-in to your SecureVault account from a <strong>${reasonLabel}</strong>.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#666;width:140px">Wallet</td>
              <td style="font-family:monospace">${short}</td></tr>
          <tr><td style="padding:6px 0;color:#666">IP address</td>
              <td>${ip}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Device / UA</td>
              <td style="word-break:break-all;font-size:12px">${userAgent.slice(0, 120)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Time (UTC)</td>
              <td>${timestamp.toUTCString()}</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #ddd;margin:20px 0"/>
        <p style="margin:0;font-size:13px;color:#555">
          <strong>If this was you</strong>, no action needed.<br/>
          <strong>If this wasn't you</strong>, your session is flagged — review your
          <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/app/security" style="color:#4f46e5">Security Log</a>
          immediately.
        </p>
      </div>
    </div>
  `;

  try {
    const transporter = await getTransporter();
    const fromAddress =
      process.env.ALERT_FROM_EMAIL ?? (process.env.SMTP_USER || "security@securevault.local");

    const info = await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject: `⚠️ SecureVault: New sign-in from ${reasonLabel}`,
      html,
      text: `Security Alert: New sign-in to wallet ${short} from ${reasonLabel} (${ip})`,
    });

    const previewUrl = isEthereal ? (nodemailer.getTestMessageUrl(info) as string) : undefined;
    return { success: true, previewUrl };
  } catch (err) {
    console.error("[email] Failed to send anomaly alert:", (err as Error).message);
    return { success: false };
  }
}
