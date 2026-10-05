"use client";

/**
 * components/ConnectWallet.tsx
 *
 * Authentication Flow:
 *   1. Restricted strictly to MetaMask and WalletConnect.
 *   2. Support for browser extensions (Firefox, Chrome, Brave) via direct EIP-1193 injected provider
 *      and @metamask/connect-evm SDK fallback.
 *   3. Captures user's notification email for login security alerts.
 *   4. SIWE (Sign-In with Ethereum) cryptographic signature verification.
 *   5. Server verifies signature, sets session cookie, and dispatches login alert email.
 */

import {
  useAccount,
  useConnect,
  useDisconnect,
  useSignMessage,
  useChainId,
} from "wagmi";
import { SiweMessage } from "siwe";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "connecting" | "signing" | "verifying" | "done" | "error";

interface ConnectWalletProps {
  redirectTo?: string;
}

export function ConnectWallet({ redirectTo = "/app/dashboard" }: ConnectWalletProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();

  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [anomaly, setAnomaly] = useState(false);
  const [email, setEmail] = useState<string>("");

  // Load saved email preference from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sv:alertEmail");
      if (saved) setEmail(saved);
    } catch {
      // ignore
    }
  }, []);

  const handleEmailChange = (val: string) => {
    setEmail(val);
    try {
      localStorage.setItem("sv:alertEmail", val);
    } catch {
      // ignore
    }
  };

  // Find dedicated connectors
  const metaMaskConnector =
    connectors.find((c) => c.id === "metaMask") ||
    connectors.find((c) => c.name.toLowerCase().includes("metamask")) ||
    connectors[0];

  const walletConnectConnector = connectors.find(
    (c) => c.id === "walletConnect" || c.name.toLowerCase().includes("walletconnect")
  );

  async function handleConnectMetaMask() {
    setErrorMsg("");
    if (!metaMaskConnector) {
      setErrorMsg("MetaMask connector not available.");
      return;
    }
    try {
      await connectAsync({ connector: metaMaskConnector });
    } catch (err: unknown) {

      const msg = err instanceof Error ? err.message : "";
      const hasEthereum =
        typeof window !== "undefined" &&
        Boolean((window as unknown as { ethereum?: unknown }).ethereum);

      if (
        msg.includes("ConnectorNotFoundError") ||
        msg.includes("Provider not found") ||
        !hasEthereum
      ) {
        setErrorMsg(
          "MetaMask extension was not detected. In Firefox, please verify that the MetaMask extension is enabled and has permission to access this site, or refresh the page."
        );
      } else if (msg.includes("User rejected")) {
        setErrorMsg("Connection request was cancelled in MetaMask.");
      } else {
        setErrorMsg(msg || "Failed to connect to MetaMask.");
      }
    }
  }

  async function handleConnectWalletConnect() {
    setErrorMsg("");
    if (!walletConnectConnector) {
      setErrorMsg("WalletConnect connector is not configured.");
      return;
    }
    try {
      await connectAsync({ connector: walletConnectConnector });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("User rejected")) {
        setErrorMsg("Connection request was cancelled.");
      } else {
        setErrorMsg(msg || "Failed to connect with WalletConnect.");
      }
    }
  }

  // ── Web3 SIWE Sign-In ────────────────────────────────────────────────────
  async function signInWithWallet() {
    if (!address) return;
    setStatus("signing");
    setErrorMsg("");

    try {
      // 1. Fetch single-use nonce
      const nonceRes = await fetch(`/api/auth/nonce?address=${address}`);
      if (!nonceRes.ok) {
        let msg = "Failed to connect to authentication service.";
        try {
          const d = await nonceRes.json();
          if (d.error) msg = d.error;
        } catch {
          msg = `Server returned status ${nonceRes.status}. Please check database connection.`;
        }
        throw new Error(msg);
      }
      const nonceData = await nonceRes.json();
      const nonce = nonceData.nonce;

      // 2. Build & request wallet signature
      const siweMessage = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to SecureVault. This signature does not grant any on-chain access.",
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce,
      });
      const message = siweMessage.prepareMessage();
      const signature = await signMessageAsync({ message });

      // 3. Verify on server and dispatch login alert email
      setStatus("verifying");
      const cleanEmail = email.trim();
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          signature,
          email: cleanEmail || undefined,
        }),
      });

      if (!verifyRes.ok) {
        const d = await verifyRes.json().catch(() => ({ error: "Verification failed." }));
        throw new Error(d.error ?? "Verification failed.");
      }

      const data = await verifyRes.json();
      setAnomaly(data.anomaly ?? false);
      setStatus("done");

      router.push(redirectTo);
      router.refresh();
    } catch (err: unknown) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : "Unknown error.";
      setErrorMsg(
        msg.toLowerCase().includes("user rejected")
          ? "Signature was cancelled in your wallet."
          : msg.length < 140
          ? msg
          : "Sign-in failed. Please try again."
      );
    }
  }

  // ── Connected view: show address badge, email field & sign-in button ────
  if (isConnected && address) {
    const statusLabel: Record<Status, string> = {
      idle: "Sign In with Wallet",
      connecting: "Connecting…",
      signing: "Check wallet to sign…",
      verifying: "Verifying signature…",
      done: "Signed in ✓",
      error: "Try Again",
    };

    return (
      <div className="flex flex-col gap-4 w-full max-w-sm">
        {/* Connected wallet badge */}
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-gray-900 border border-gray-700/80">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
              Connected Wallet
            </span>
            <span className="text-gray-100 text-xs font-mono font-bold">
              {address.slice(0, 6)}…{address.slice(-4)}
            </span>
          </div>
          <button
            onClick={() => disconnect()}
            className="ml-auto text-xs text-gray-400 hover:text-red-300 transition-colors px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700"
          >
            Disconnect
          </button>
        </div>

        {/* Email input field for login notification */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Login Notification Email
            </span>
            <span className="text-[10px] text-gray-500 font-normal">Optional</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => handleEmailChange(e.target.value)}
            placeholder="you@example.com"
            disabled={status === "signing" || status === "verifying" || status === "done"}
            className="w-full px-3.5 py-2.5 rounded-xl bg-gray-900 border border-gray-700 text-gray-100 placeholder-gray-500 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
          />
          <p className="text-[11px] text-gray-400 leading-normal">
            A confirmation email will be sent to this address whenever you sign into SecureVault.
          </p>
        </div>

        {anomaly && (
          <div className="px-4 py-3 rounded-xl bg-amber-950/80 border border-amber-700 text-amber-200 text-xs">
            ⚠️ New location or device detected. This sign-in was recorded in your security log.
          </div>
        )}

        {status === "error" && errorMsg && (
          <div className="px-4 py-3 rounded-xl bg-red-950/80 border border-red-700 text-red-200 text-xs">
            {errorMsg}
          </div>
        )}

        <button
          onClick={signInWithWallet}
          disabled={status === "signing" || status === "verifying" || status === "done"}
          className="px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500
                     text-white font-semibold text-sm transition-all duration-150
                     disabled:opacity-60 disabled:cursor-not-allowed
                     flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/50"
        >
          {(status === "signing" || status === "verifying") && (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          )}
          {statusLabel[status]}
        </button>
      </div>
    );
  }

  // ── Not connected view: Email input & MetaMask / WalletConnect buttons ──
  return (
    <div className="flex flex-col gap-4 w-full max-w-sm">
      {/* Email input field */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gray-300 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Login Alert Email
          </span>
          <span className="text-[10px] text-gray-500 font-normal">Optional</span>
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => handleEmailChange(e.target.value)}
          placeholder="Enter email for login alerts"
          className="w-full px-3.5 py-2.5 rounded-xl bg-gray-900 border border-gray-700 text-gray-100 placeholder-gray-500 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
        />
        <p className="text-[11px] text-gray-400">
          We&apos;ll send a security alert to this email when you sign in.
        </p>
      </div>

      <div className="flex items-center gap-2 my-1">
        <div className="h-px flex-1 bg-gray-800" />
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
          Select Wallet
        </span>
        <div className="h-px flex-1 bg-gray-800" />
      </div>

      {/* Wallet Connectors: MetaMask & WalletConnect */}
      <div className="flex flex-col gap-2.5">
        {/* 🦊 MetaMask Connector Button */}
        <button
          onClick={handleConnectMetaMask}
          disabled={isConnecting}
          className="flex items-center justify-between px-4 py-3.5 rounded-xl border border-gray-800
                     bg-gray-900/90 hover:bg-gray-800 hover:border-orange-500/50 hover:shadow-md hover:shadow-orange-950/30
                     text-gray-200 text-sm font-medium transition-all duration-150
                     disabled:opacity-50 disabled:cursor-not-allowed text-left group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" viewBox="0 0 32 32" fill="none">
                <path d="M29.5 13.2L27 3.5l-8.6 6.3L29.5 13.2z" fill="#E17726"/>
                <path d="M2.5 13.2L5 3.5l8.6 6.3L2.5 13.2z" fill="#E27625"/>
                <path d="M23.5 22.7l-4.1 6.3 7.8 2.2 2.3-8.5h-6z" fill="#E27625"/>
                <path d="M8.5 22.7l4.1 6.3-7.8 2.2-2.3-8.5h6z" fill="#E27625"/>
                <path d="M10.8 14.1l-2.4 3.7 8.5.4-.3-9.5-5.8 5.4z" fill="#E27625"/>
                <path d="M21.2 14.1l2.4 3.7-8.5.4.3-9.5 5.8 5.4z" fill="#E27625"/>
                <path d="M10.8 20.4l-3.9 1.1 3.5 2.8 3.8-3.9h-3.4z" fill="#D5BFB2"/>
                <path d="M21.2 20.4l3.9 1.1-3.5 2.8-3.8-3.9h3.4z" fill="#D5BFB2"/>
                <path d="M14.2 20.4l-3.8 3.9 4 2.1 4-2.1-3.8-3.9h-.4z" fill="#393939"/>
              </svg>
            </div>
            <div>
              <span className="block text-sm font-semibold text-gray-100 group-hover:text-white">
                MetaMask
              </span>
              <span className="block text-[11px] text-gray-400">
                Firefox extension & browser wallet
              </span>
            </div>
          </div>
          <span className="text-gray-500 group-hover:text-orange-400 text-xs transition-colors">
            Connect →
          </span>
        </button>

        {/* 🔗 WalletConnect Button */}
        <button
          onClick={handleConnectWalletConnect}
          disabled={isConnecting}
          className="flex items-center justify-between px-4 py-3.5 rounded-xl border border-gray-800
                     bg-gray-900/90 hover:bg-gray-800 hover:border-blue-500/50 hover:shadow-md hover:shadow-blue-950/30
                     text-gray-200 text-sm font-medium transition-all duration-150
                     disabled:opacity-50 disabled:cursor-not-allowed text-left group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.5 8.5C9.09 4.91 14.91 4.91 18.5 8.5l.6.6c.2.2.2.5 0 .7l-1.4 1.4c-.2.2-.5.2-.7 0l-.8-.8c-2.43-2.43-6.37-2.43-8.8 0l-.9.9c-.2.2-.5.2-.7 0L4.4 9.9c-.2-.2-.2-.5 0-.7l1.1-.7zm16.5 3.5l1.6 1.6c.2.2.2.5 0 .7l-7.3 7.3c-.2.2-.5.2-.7 0l-5.2-5.2c-.1-.1-.3-.1-.4 0l-5.2 5.2c-.2.2-.5.2-.7 0l-7.3-7.3c-.2-.2-.2-.5 0-.7l1.6-1.6c.2-.2.5-.2.7 0l5.2 5.2c.1.1.3.1.4 0l5.2-5.2c.2-.2.5-.2.7 0l5.2 5.2c.1.1.3.1.4 0l5.2-5.2c.2-.2.5-.2.7 0z"/>
              </svg>
            </div>
            <div>
              <span className="block text-sm font-semibold text-gray-100 group-hover:text-white">
                WalletConnect
              </span>
              <span className="block text-[11px] text-gray-400">
                Scan QR with Rainbow, Trust, etc.
              </span>
            </div>
          </div>
          <span className="text-gray-500 group-hover:text-blue-400 text-xs transition-colors">
            Connect →
          </span>
        </button>
      </div>

      {/* Error or feedback message */}
      {errorMsg && (
        <div className="px-4 py-3 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs leading-relaxed">
          {errorMsg}
        </div>
      )}

      {(status === "signing" || status === "verifying") && (
        <div className="flex items-center justify-center gap-2 text-indigo-300 text-xs py-1">
          <span className="w-3.5 h-3.5 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
          <span>{status === "signing" ? "Signing SIWE verification…" : "Verifying with server…"}</span>
        </div>
      )}
    </div>
  );
}
