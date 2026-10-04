"use client";

/**
 * components/ProfileSettings.tsx
 *
 * User profile and cryptographic identity dashboard:
 *   - Connected wallet identity and network info
 *   - Local ECDH key pair status, fingerprint, and re-generation
 *   - Security alert notification email configuration & verification (OTP)
 *   - Instant test notification dispatcher
 */

import { useState, useEffect } from "react";
import { useAccount, useChainId } from "wagmi";
import { loadKeyPair, getOrCreateKeyPair, exportPublicKeyJwk } from "@/lib/keyPair";

interface ProfileSettingsProps {
  initialEmail: string | null;
  initialEmailVerified?: boolean;
  role: string;
  createdAt: string;
}

export function ProfileSettings({
  initialEmail,
  initialEmailVerified = false,
  role,
  createdAt,
}: ProfileSettingsProps) {
  const { address } = useAccount();
  const chainId = useChainId();

  const [email, setEmail] = useState(initialEmail ?? "");
  const [isVerified, setIsVerified] = useState(initialEmailVerified);
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<string>("");

  // OTP Verification state
  const [verifStep, setVerifStep] = useState<"idle" | "sending" | "sent" | "verifying" | "done">("idle");
  const [otpCode, setOtpCode] = useState("");
  const [verifFeedback, setVerifFeedback] = useState("");
  const [emailPreviewUrl, setEmailPreviewUrl] = useState<string | null>(null);

  // Test Notification state
  const [testNotifLoading, setTestNotifLoading] = useState(false);
  const [testNotifFeedback, setTestNotifFeedback] = useState<string>("");

  const [hasLocalKey, setHasLocalKey] = useState<boolean | null>(null);
  const [pubKeyFingerprint, setPubKeyFingerprint] = useState<string>("");
  const [generatingKey, setGeneratingKey] = useState(false);

  useEffect(() => {
    async function checkKeys() {
      const kp = await loadKeyPair();
      if (kp) {
        setHasLocalKey(true);
        const jwk = await exportPublicKeyJwk(kp.publicKey);
        const str = JSON.stringify(jwk);
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
        const hex = Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        setPubKeyFingerprint(hex.slice(0, 24));
      } else {
        setHasLocalKey(false);
      }
    }
    checkKeys();
  }, []);

  async function handleSaveEmail(e: React.FormEvent) {
    e.preventDefault();
    setSavingEmail(true);
    setEmailFeedback("");
    try {
      const res = await fetch("/api/security", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Failed to save email preference.");
      setEmailFeedback("✓ Alert email preference updated.");
      if (email !== initialEmail) {
        setIsVerified(false); // If user changed their email, reset verified status
      }
    } catch {
      setEmailFeedback("⚠️ Could not update email.");
    } finally {
      setSavingEmail(false);
    }
  }

  async function handleSendVerificationCode() {
    if (!email) {
      setEmailFeedback("Please enter an email address first.");
      return;
    }
    setVerifStep("sending");
    setVerifFeedback("");
    setEmailPreviewUrl(null);
    try {
      const res = await fetch("/api/auth/email/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send code.");

      setVerifStep("sent");
      setVerifFeedback(data.message || "Verification code sent to your email!");
      if (data.previewUrl) {
        setEmailPreviewUrl(data.previewUrl);
      }
      if (data.code) {
        // Helpful test banner in dev mode
        setVerifFeedback(`Verification code dispatched! (Dev Code: ${data.code})`);
      }
    } catch (err: unknown) {
      setVerifStep("idle");
      setVerifFeedback(err instanceof Error ? err.message : "Failed to send code.");
    }
  }

  async function handleConfirmOtp() {
    if (!otpCode || otpCode.length < 6) {
      setVerifFeedback("Please enter the full 6-digit verification code.");
      return;
    }
    setVerifStep("verifying");
    try {
      const res = await fetch("/api/auth/email/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to verify code.");

      setIsVerified(true);
      setVerifStep("done");
      setVerifFeedback("🎉 Email verified successfully!");
    } catch (err: unknown) {
      setVerifStep("sent");
      setVerifFeedback(err instanceof Error ? err.message : "Verification failed.");
    }
  }

  async function handleSendTestNotification() {
    if (!email) {
      setTestNotifFeedback("Please save a notification email first.");
      return;
    }
    setTestNotifLoading(true);
    setTestNotifFeedback("");
    try {
      const res = await fetch("/api/auth/email/test-notification", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send test notification.");
      setTestNotifFeedback(data.message);
      if (data.previewUrl) {
        setEmailPreviewUrl(data.previewUrl);
      }
    } catch (err: unknown) {
      setTestNotifFeedback(err instanceof Error ? err.message : "Failed to dispatch test notification.");
    } finally {
      setTestNotifLoading(false);
    }
  }

  async function handleRegenerateKeyPair() {
    if (
      hasLocalKey &&
      !confirm(
        "Warning: Generating a new ECDH key pair will replace your local private key. Any pending encrypted shares addressed to your previous public key will no longer be decryptable. Continue?"
      )
    ) {
      return;
    }

    setGeneratingKey(true);
    try {
      localStorage.removeItem("sv:ecdhKeyPair");
      const kp = await getOrCreateKeyPair();
      const pubJwk = await exportPublicKeyJwk(kp.publicKey);

      if (address) {
        await fetch(`/api/users/${address.toLowerCase()}/pubkey`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicKey: pubJwk }),
        });
      }

      setHasLocalKey(true);
      const str = JSON.stringify(pubJwk);
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      const hex = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      setPubKeyFingerprint(hex.slice(0, 24));
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setGeneratingKey(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Wallet Identity Card ────────────────────────────────────────── */}
      <div className="vault-card flex flex-col gap-4 border-gray-800">
        <div className="flex items-center justify-between border-b border-gray-800/80 pb-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>Wallet Identity</span>
              <span className="badge-encrypted text-[10px]">SIWE Authenticated</span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Your Ethereum wallet is your cryptographic credential. No passwords exist.
            </p>
          </div>
          <span className="text-xs font-mono text-indigo-400 px-2.5 py-1 rounded-full bg-indigo-950/60 border border-indigo-800">
            Chain ID: {chainId ?? 1}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-gray-500 block mb-1">Wallet Address</span>
            <span className="font-mono text-gray-200 text-sm bg-gray-950 px-3 py-2 rounded-lg border border-gray-800 block truncate">
              {address ?? "Loading…"}
            </span>
          </div>

          <div>
            <span className="text-gray-500 block mb-1">Role / Account Tier</span>
            <span className="font-semibold text-gray-200 capitalize bg-gray-950 px-3 py-2 rounded-lg border border-gray-800 block">
              {role === "admin" ? "⚡ Administrator (Zero-Knowledge)" : "Standard User Vault"}
            </span>
          </div>
        </div>

        <div className="text-[11px] text-gray-500 pt-1">
          Account created on{" "}
          {new Date(createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
          .
        </div>
      </div>

      {/* ── Security Alert Notifications & Verification Card ──────────── */}
      <div className="vault-card flex flex-col gap-4 border-gray-800">
        <div className="border-b border-gray-800/80 pb-3 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>Email Verification & Notifications</span>
              {isVerified ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700">
                  ✓ Verified
                </span>
              ) : email ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-700">
                  ⚠️ Unverified
                </span>
              ) : null}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Receive instant alerts whenever your wallet signs into SecureVault or when an anomaly occurs.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveEmail} className="flex flex-col gap-3">
          <div className="flex gap-2 flex-col sm:flex-row">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alerts@yourdomain.com"
              className="flex-1 px-3.5 py-2.5 rounded-xl text-sm bg-gray-950 border border-gray-700 text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={savingEmail}
              className="px-5 py-2.5 text-sm font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-all disabled:opacity-50 flex-shrink-0"
            >
              {savingEmail ? "Saving…" : "Save Email"}
            </button>
          </div>
          {emailFeedback && (
            <p className={`text-xs ${emailFeedback.startsWith("✓") ? "text-emerald-400" : "text-amber-400"}`}>
              {emailFeedback}
            </p>
          )}
        </form>

        {/* ── Email Verification OTP Flow ── */}
        {email && !isVerified && (
          <div className="p-4 rounded-xl bg-gray-950 border border-gray-800 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-gray-200 block">
                  Verify Email Address
                </span>
                <span className="text-[11px] text-gray-400">
                  Send a 6-digit confirmation code to {email}
                </span>
              </div>
              {verifStep === "idle" && (
                <button
                  type="button"
                  onClick={handleSendVerificationCode}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all"
                >
                  Send 6-Digit Code
                </button>
              )}
            </div>

            {verifStep === "sending" && (
              <p className="text-xs text-indigo-400 animate-pulse">
                Dispatching verification email…
              </p>
            )}

            {(verifStep === "sent" || verifStep === "verifying") && (
              <div className="flex flex-col gap-2 pt-2 border-t border-gray-800">
                <label className="text-[11px] text-gray-300">
                  Enter the 6-digit code sent to your email:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    className="w-36 tracking-widest text-center font-mono font-bold text-base px-3 py-2 rounded-lg bg-gray-900 border border-indigo-500/50 text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleConfirmOtp}
                    disabled={verifStep === "verifying" || otpCode.length < 6}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all disabled:opacity-50"
                  >
                    {verifStep === "verifying" ? "Verifying…" : "Confirm Code"}
                  </button>
                  <button
                    type="button"
                    onClick={handleSendVerificationCode}
                    className="px-3 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    Resend
                  </button>
                </div>
              </div>
            )}

            {verifFeedback && (
              <p className={`text-xs ${verifFeedback.startsWith("🎉") ? "text-emerald-400" : "text-indigo-300"}`}>
                {verifFeedback}
              </p>
            )}
          </div>
        )}

        {/* ── Test Notification Dispatcher ── */}
        {email && (
          <div className="flex items-center justify-between pt-2 border-t border-gray-800/80">
            <span className="text-xs text-gray-400">
              Verify notification delivery:
            </span>
            <button
              type="button"
              onClick={handleSendTestNotification}
              disabled={testNotifLoading}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-all disabled:opacity-50"
            >
              {testNotifLoading ? "Sending…" : "Send Test Login Notification"}
            </button>
          </div>
        )}

        {testNotifFeedback && (
          <p className="text-xs text-indigo-300">
            {testNotifFeedback}
          </p>
        )}

        {/* Live Email Preview Box (when Ethereal is used) */}
        {emailPreviewUrl && (
          <div className="p-3.5 rounded-xl bg-indigo-950/60 border border-indigo-700/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-indigo-200">
              <span>📧</span>
              <span><strong>Live Email Generated:</strong> Click to view the rendered email in your browser</span>
            </div>
            <a
              href={emailPreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all flex-shrink-0"
            >
              Open Email Preview ↗
            </a>
          </div>
        )}
      </div>

      {/* ── Asymmetric Encryption & Keypair Card ───────────────────────── */}
      <div className="vault-card flex flex-col gap-4 border-indigo-900/40 bg-indigo-950/10">
        <div className="flex items-center justify-between border-b border-indigo-900/30 pb-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>ECDH P-256 Sharing Keypair</span>
              <span className="badge-syncing text-[10px]">Client-Isolated</span>
            </h2>
            <p className="text-xs text-indigo-300 mt-0.5">
              Used to wrap and receive shared file keys between wallets. Private key stays in local storage.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-950 p-4 rounded-xl border border-gray-800">
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${hasLocalKey ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className="text-xs font-semibold text-gray-200">
                {hasLocalKey ? "Keypair Active in Local Storage" : "No Keypair Detected"}
              </span>
            </div>
            {pubKeyFingerprint && (
              <p className="text-[11px] font-mono text-gray-500 mt-1">
                Fingerprint: {pubKeyFingerprint}…
              </p>
            )}
          </div>

          <button
            onClick={handleRegenerateKeyPair}
            disabled={generatingKey}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all disabled:opacity-50 flex-shrink-0"
          >
            {generatingKey ? "Generating…" : hasLocalKey ? "Rotate Keypair" : "Generate Keypair"}
          </button>
        </div>
      </div>
    </div>
  );
}
