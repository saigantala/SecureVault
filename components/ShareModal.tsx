"use client";

/**
 * components/ShareModal.tsx
 *
 * "Share with wallet" modal — implements the full client-side key-wrapping flow:
 *
 *   1. User enters a grantee wallet address + optional expiry.
 *   2. Wallet signs the key-derivation message → extractable file key.
 *   3. Load/generate user's ECDH key pair (P-256, stored in localStorage).
 *   4. Ensure user's public key is registered on the server.
 *   5. Fetch grantee's ECDH public key from /api/users/[address]/pubkey.
 *   6. ECDH(ownerPrivKey, granteePublicKey) → shared AES-256-KW secret.
 *   7. wrapKey(fileKey, AES-KW, sharedSecret) → wrappedKey (base64).
 *   8. POST /api/grants { fileId, grantedToAddress, wrappedKey, expiresAt }.
 *
 * Security: the raw file key exists in memory only for the duration of step 7.
 *           The server receives only the wrapped key — it cannot unwrap it
 *           without the owner's ECDH private key, which never leaves the browser.
 */

import { useState, useEffect } from "react";
import { useSignMessage, useAccount } from "wagmi";
import {
  getOrCreateKeyPair,
  deriveFileKeyExtractable,
  deriveSharedAesKey,
  wrapFileKey,
  importPublicKeyJwk,
  exportPublicKeyJwk,
} from "@/lib/keyPair";

interface ShareModalProps {
  fileId: string;
  onClose: () => void;
  onGranted: () => void;
}

type Step =
  | "idle"
  | "ensuring_keypair"
  | "signing_key"
  | "fetching_pubkey"
  | "wrapping"
  | "submitting"
  | "done"
  | "error";

const STEP_LABELS: Record<Step, string> = {
  idle:              "Share file",
  ensuring_keypair:  "Setting up encryption keys…",
  signing_key:       "Check your wallet — signing for key derivation…",
  fetching_pubkey:   "Looking up grantee's public key…",
  wrapping:          "Encrypting key for recipient…",
  submitting:        "Creating grant…",
  done:              "Shared!",
  error:             "Share file",
};

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const KEY_DERIVATION_MESSAGE =
  "SecureVault: I authorize key derivation for my encrypted vault. This signature is not a transaction.";

export function ShareModal({ fileId, onClose, onGranted }: ShareModalProps) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [granteeAddress, setGranteeAddress] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string>("");
  const [grants, setGrants] = useState<{ id: string; granted_to_address: string; expires_at: string | null; revoked_at: string | null; created_at: string }[]>([]);
  const [loadingGrants, setLoadingGrants] = useState(true);
  const [admins, setAdmins] = useState<{ wallet_address: string; has_pubkey: boolean }[]>([]);

  // Load existing grants and registered admins
  useEffect(() => {
    fetch(`/api/grants?fileId=${fileId}`)
      .then((r) => r.json())
      .then((d) => setGrants(d.grants ?? []))
      .catch(() => {})
      .finally(() => setLoadingGrants(false));

    fetch("/api/users/admins")
      .then((r) => r.json())
      .then((d) => setAdmins(d.admins ?? []))
      .catch(() => {});
  }, [fileId]);

  async function handleShare() {
    setError("");

    if (!ETH_ADDRESS_RE.test(granteeAddress)) {
      setError("Enter a valid Ethereum wallet address.");
      return;
    }
    if (!address) {
      setError("Wallet not connected.");
      return;
    }

    try {
      // Step 1: Ensure ECDH key pair exists + is uploaded
      setStep("ensuring_keypair");
      const myKeyPair = await getOrCreateKeyPair();
      const myPubJwk = await exportPublicKeyJwk(myKeyPair.publicKey);

      const pubRes = await fetch(`/api/users/${address}/pubkey`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: myPubJwk }),
      });
      if (!pubRes.ok) throw new Error("Failed to register your encryption key.");

      // Step 2: Sign to derive extractable file key
      setStep("signing_key");
      const signature = await signMessageAsync({ message: KEY_DERIVATION_MESSAGE });
      const fileKey = await deriveFileKeyExtractable(signature);

      // Step 3: Fetch grantee's public key
      setStep("fetching_pubkey");
      const granteeRes = await fetch(
        `/api/users/${granteeAddress.toLowerCase()}/pubkey`
      );
      if (!granteeRes.ok) {
        throw new Error(
          "Grantee has no encryption key registered. They must sign into SecureVault first."
        );
      }
      const { publicKey: granteeJwk } = await granteeRes.json();
      const granteePubKey = await importPublicKeyJwk(granteeJwk as JsonWebKey);

      // Step 4: ECDH → shared secret → wrap file key
      setStep("wrapping");
      const sharedKey = await deriveSharedAesKey(myKeyPair.privateKey, granteePubKey);
      const wrappedKey = await wrapFileKey(fileKey, sharedKey);

      // Step 5: Create grant on server
      setStep("submitting");
      const grantRes = await fetch("/api/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          grantedToAddress: granteeAddress.toLowerCase(),
          wrappedKey,
          expiresAt: expiresAt || null,
        }),
      });

      if (!grantRes.ok) {
        const { error: serverError } = await grantRes.json();
        throw new Error(serverError ?? "Failed to create grant.");
      }

      setStep("done");
      onGranted();

      // Refresh grant list
      const updatedGrants = await fetch(`/api/grants?fileId=${fileId}`).then((r) => r.json());
      setGrants(updatedGrants.grants ?? []);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message.toLowerCase().includes("user rejected")
            ? "Wallet signature cancelled."
            : err.message
          : "Unknown error.";
      setError(msg);
      setStep("error");
    }
  }

  async function handleRevoke(grantId: string) {
    const res = await fetch(`/api/grants/${grantId}`, { method: "DELETE" });
    if (res.ok) {
      setGrants((prev) =>
        prev.map((g) => (g.id === grantId ? { ...g, revoked_at: new Date().toISOString() } : g))
      );
    }
  }

  const isBusy = !["idle", "done", "error"].includes(step);
  const activeGrants = grants.filter((g) => !g.revoked_at);
  const revokedGrants = grants.filter((g) => g.revoked_at);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl
                      shadow-2xl shadow-black/60 flex flex-col gap-6 p-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Share file</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              The recipient&apos;s key is wrapped with ECDH — the server never sees the raw file key.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Security notice */}
        <div className="px-3 py-2.5 rounded-lg bg-indigo-950 border border-indigo-800 text-indigo-200 text-xs leading-relaxed">
          <strong>Zero-knowledge sharing:</strong> You sign once to derive an extractable key, wrap it
          under ECDH, then the raw key is immediately discarded. Only the recipient can unwrap it.
        </div>

        {/* New grant form */}
        {step !== "done" && (
          <div className="flex flex-col gap-3">
            {admins.length > 0 && (
              <div className="p-2.5 rounded-lg border border-amber-900/50 bg-amber-950/20 flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-amber-300 block">Share with Admin</span>
                  <span className="text-[11px] text-gray-400 block">Admin has no default access; grant is purely opt-in</span>
                </div>
                <button
                  type="button"
                  onClick={() => setGranteeAddress(admins[0].wallet_address)}
                  className="px-2.5 py-1 text-xs font-medium rounded-md bg-amber-600 hover:bg-amber-500 text-white transition-all flex-shrink-0"
                >
                  Select Admin
                </button>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-gray-400 mb-1 block">
                Grantee wallet address
              </label>
              <input
                type="text"
                value={granteeAddress}
                onChange={(e) => setGranteeAddress(e.target.value)}
                placeholder="0x…"
                disabled={isBusy}
                className="w-full px-3 py-2 rounded-lg text-sm font-mono
                           bg-gray-950 border border-gray-700 text-gray-100
                           placeholder:text-gray-600
                           focus:outline-none focus:border-indigo-500
                           disabled:opacity-50"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-400 mb-1 block">
                Expiry (optional)
              </label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={isBusy}
                className="w-full px-3 py-2 rounded-lg text-sm
                           bg-gray-950 border border-gray-700 text-gray-400
                           focus:outline-none focus:border-indigo-500
                           disabled:opacity-50"
              />
            </div>

            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-950 border border-red-800 text-red-200 text-xs">
                ⚠️ {error}
              </div>
            )}

            {isBusy && (
              <div className="flex items-center gap-2 text-indigo-300 text-sm">
                <span className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
                {STEP_LABELS[step]}
              </div>
            )}

            <button
              onClick={handleShare}
              disabled={isBusy || !granteeAddress}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500
                         text-white font-semibold text-sm transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {STEP_LABELS[step]}
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="px-4 py-3 rounded-xl bg-emerald-950 border border-emerald-800 text-emerald-200 text-sm text-center">
            ✓ File shared successfully.
          </div>
        )}

        {/* Existing grants */}
        {!loadingGrants && (activeGrants.length > 0 || revokedGrants.length > 0) && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Active grants ({activeGrants.length})
            </p>
            {activeGrants.map((g) => (
              <div key={g.id} className="flex items-center gap-2 px-3 py-2
                                         rounded-lg bg-gray-950 border border-gray-800 text-xs">
                <span className="font-mono text-gray-300 flex-1 truncate">
                  {g.granted_to_address.slice(0, 10)}…{g.granted_to_address.slice(-6)}
                </span>
                {g.expires_at && (
                  <span className="text-gray-500">
                    expires {new Date(g.expires_at).toLocaleDateString()}
                  </span>
                )}
                <button
                  onClick={() => handleRevoke(g.id)}
                  className="text-red-500 hover:text-red-400 transition-colors flex-shrink-0"
                >
                  Revoke
                </button>
              </div>
            ))}

            {revokedGrants.length > 0 && (
              <>
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mt-2">
                  Revoked ({revokedGrants.length})
                </p>
                {revokedGrants.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 px-3 py-2
                                              rounded-lg bg-gray-950/50 border border-gray-800/50
                                              text-xs opacity-50 line-through">
                    <span className="font-mono text-gray-500 flex-1 truncate">
                      {g.granted_to_address.slice(0, 10)}…
                    </span>
                    <span className="text-gray-600">revoked</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
