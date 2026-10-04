// app/page.tsx — SecureVault Landing Page
import Link from "next/link";
import { getSession } from "@/lib/session";

export const metadata = {
  title: "SecureVault — Zero-Knowledge Encrypted Storage",
  description: "End-to-end encrypted file vault powered by Web Crypto and Sign-In With Ethereum.",
};

export default async function HomePage() {
  const session = await getSession();

  return (
    <div className="min-h-screen flex flex-col bg-gray-950 text-gray-100 selection:bg-indigo-500 selection:text-white">
      {/* ── Top Header ──────────────────────────────────────────────────── */}
      <header className="border-b border-gray-800/80 bg-gray-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white" stroke="currentColor" strokeWidth={2.5}>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <span className="font-bold text-base text-white tracking-tight">SecureVault</span>
          </div>

          <div className="flex items-center gap-4">
            {session ? (
              <Link
                href="/app/dashboard"
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-md shadow-indigo-900/40"
              >
                Go to Vault →
              </Link>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-md shadow-indigo-900/40"
              >
                Connect Wallet
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero Section ────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-24 pb-20 px-4">
        {/* Glow backdrop */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-indigo-600/15 blur-[120px] rounded-full pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative z-10 flex flex-col items-center gap-6">
          {/* Status Badges */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="badge-encrypted text-xs py-1 px-3">
              🔒 In-Browser AES-256-GCM
            </span>
            <span className="badge-syncing text-xs py-1 px-3">
              ⚡ Sign-In With Ethereum
            </span>
            <span className="badge-warning text-xs py-1 px-3">
              🛡️ Zero-Knowledge Server
            </span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-[1.15]">
            Encrypted in your browser. <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-indigo-200 to-indigo-500">
              Invisible to the server.
            </span>
          </h1>

          <p className="max-w-2xl text-base sm:text-lg text-gray-400 leading-relaxed">
            SecureVault delivers cryptographically guaranteed zero-knowledge file storage.
            Decryption keys are derived directly from your wallet signature using HKDF and never touch any backend.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3 mt-4">
            <Link
              href={session ? "/app/dashboard" : "/login"}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all shadow-xl shadow-indigo-900/50 flex items-center justify-center gap-2"
            >
              <span>{session ? "Open Your Vault" : "Connect Wallet & Enter"}</span>
              <span>→</span>
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl border border-gray-800 bg-gray-900/50 hover:bg-gray-800/80 text-gray-300 font-medium text-sm transition-all text-center"
            >
              Architecture & Security Spec
            </a>
          </div>
        </div>
      </section>

      {/* ── Core Guarantees Grid ────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 py-16 w-full border-t border-gray-800/60">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold text-white tracking-tight">Non-Negotiable Security Principles</h2>
          <p className="text-sm text-gray-400 mt-1">Mathematical guarantees implemented through Web Crypto standards.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="vault-card flex flex-col gap-3 border-gray-800">
            <span className="text-3xl">🔑</span>
            <h3 className="text-base font-semibold text-white">Client-Side Key Derivation</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Keys are generated in memory from a wallet signature using HKDF-SHA-256. Marked non-extractable, they never leave your device.
            </p>
          </div>

          <div className="vault-card flex flex-col gap-3 border-gray-800">
            <span className="text-3xl">📦</span>
            <h3 className="text-base font-semibold text-white">Ciphertext-Only Ingestion</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Files are AES-256-GCM encrypted in the browser before upload. Server and S3 storage only ever receive and store encrypted blobs.
            </p>
          </div>

          <div className="vault-card flex flex-col gap-3 border-gray-800">
            <span className="text-3xl">🛡️</span>
            <h3 className="text-base font-semibold text-white">Zero Admin Backdoors</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              The administrator has no master key. Admin access to any file is impossible unless the owner explicitly creates an ECDH access grant.
            </p>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="mt-auto border-t border-gray-800 py-8 px-4 text-center text-xs text-gray-500">
        <p>SecureVault — Zero-Knowledge Architecture. Built with Web Crypto, wagmi, SIWE, and Next.js.</p>
      </footer>
    </div>
  );
}
