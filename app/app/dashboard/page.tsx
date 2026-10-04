// app/app/dashboard/page.tsx — /app/dashboard (protected)
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard — SecureVault" };

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const addr = session.address;
  const shortAddr = `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  // Query user's personal vault statistics
  const [filesResult, storageResult, receivedResult] = await Promise.all([
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM files WHERE owner_id = $1 AND deleted_at IS NULL`,
      [session!.sub]
    ),
    db.query<{ total: string }>(
      `SELECT COALESCE(SUM(fv.size_bytes), 0) AS total
       FROM file_versions fv
       JOIN files f ON f.id = fv.file_id
       WHERE f.owner_id = $1 AND f.deleted_at IS NULL`,
      [session!.sub]
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM access_grants
       WHERE granted_to = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())`,
      [session!.sub]
    ),
  ]);

  const fileCount = parseInt(filesResult.rows[0].count, 10);
  const storageBytes = parseInt(storageResult.rows[0].total, 10);
  const receivedGrantsCount = parseInt(receivedResult.rows[0].count, 10);

  const cards = [
    {
      href: "/app/upload",
      icon: "↑",
      title: "Upload Files",
      desc: "Drag & drop — encrypted in your browser before upload.",
      tag: "Client AES-256",
    },
    {
      href: "/app/files",
      icon: "🗂",
      title: "My Files",
      desc: `Browse and download your ${fileCount} encrypted file${fileCount !== 1 ? "s" : ""}.`,
      tag: `${fileCount} Files`,
    },
    {
      href: "/app/security",
      icon: "🛡",
      title: "Security Log",
      desc: "Review your immutable audit log, sessions, and alerts.",
      tag: "Tamper-Evident",
    },
    {
      href: "/app/profile",
      icon: "👤",
      title: "Identity & Keys",
      desc: "Manage your ECDH sharing keypair and alert notifications.",
      tag: "P-256 Keypair",
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* ── Welcome header ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Vault Dashboard
          </h1>
          <p className="text-gray-400 mt-1 text-sm">
            Connected as <span className="font-mono text-indigo-400 font-semibold">{shortAddr}</span>.
            Your files never touch the server in plaintext.
          </p>
        </div>

        {/* Live Status Indicators */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="badge-encrypted text-xs py-1 px-3">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Encrypted
          </span>
          <span className="badge-syncing text-xs py-1 px-3">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            Verified SIWE
          </span>
          {session?.anomaly ? (
            <span className="badge-warning text-xs py-1 px-3">
              Flagged Session
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800/80">
              ✓ Verified Secure
            </span>
          )}
        </div>
      </div>

      {/* ── Quick Stats Strip ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="vault-card flex flex-col gap-1 border-gray-800">
          <span className="text-xs text-gray-500 font-medium">Vault Files</span>
          <span className="text-2xl font-bold text-white">{fileCount}</span>
          <span className="text-[11px] text-emerald-400 mt-auto">AES-256-GCM Encrypted</span>
        </div>

        <div className="vault-card flex flex-col gap-1 border-gray-800">
          <span className="text-xs text-gray-500 font-medium">Ciphertext Stored</span>
          <span className="text-2xl font-bold text-white">{formatBytes(storageBytes)}</span>
          <span className="text-[11px] text-gray-400 mt-auto">Stored in Object Storage</span>
        </div>

        <div className="vault-card flex flex-col gap-1 border-gray-800">
          <span className="text-xs text-gray-500 font-medium">Shared With You</span>
          <span className="text-2xl font-bold text-indigo-400">{receivedGrantsCount}</span>
          <span className="text-[11px] text-indigo-300 mt-auto">Active Access Grants</span>
        </div>

        <div className="vault-card flex flex-col gap-1 border-gray-800">
          <span className="text-xs text-gray-500 font-medium">Session Status</span>
          <span className="text-2xl font-bold text-emerald-400">Active</span>
          <span className="text-[11px] text-gray-400 mt-auto">2h Session Expiry</span>
        </div>
      </div>

      {/* ── Cryptographic Guarantee Strip ───────────────────────────────── */}
      <div className="p-4 rounded-2xl bg-indigo-950/20 border border-indigo-900/50 flex flex-wrap gap-4 items-center justify-between text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <span className="text-base">🔒</span>
          <span>Encryption: <strong className="text-gray-200">AES-256-GCM (Web Crypto)</strong></span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base">🔑</span>
          <span>Key Derivation: <strong className="text-gray-200">HKDF from Wallet Signature</strong></span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base">🛡️</span>
          <span>Server Role: <strong className="text-gray-200">Zero-Knowledge Relay</strong></span>
        </div>
      </div>

      {/* ── Action Navigation Grid ──────────────────────────────────────── */}
      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(({ href, icon, title, desc, tag }) => (
          <Link
            key={href}
            href={href}
            className="group p-5 rounded-2xl border border-gray-800 bg-gray-900/80
                       hover:border-indigo-600/60 hover:bg-gray-800/80
                       transition-all duration-200 flex flex-col gap-3 shadow-lg shadow-black/20"
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl">{icon}</span>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 group-hover:bg-indigo-950 group-hover:text-indigo-300 transition-colors">
                {tag}
              </span>
            </div>
            <div>
              <h2 className="font-semibold text-white group-hover:text-indigo-300 transition-colors">
                {title}
              </h2>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">{desc}</p>
            </div>
            <span className="text-xs text-indigo-400 font-medium group-hover:translate-x-0.5 transition-transform mt-auto flex items-center gap-1">
              Enter →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
