"use client";

/**
 * components/AdminDashboard.tsx
 *
 * Administrative monitoring dashboard:
 *   - Aggregate statistics (users, ciphertext storage, failed logins, WAF blocks, anomalies)
 *   - Zero-Knowledge security guarantee banner
 *   - Explicitly shared files with the admin (decrypted in-browser via SharedFileCard)
 *   - Full system audit log with event filters
 *
 * Guaranteed: NO code path in this UI or its backend can decrypt or view user files
 * without an explicit access grant from the file owner.
 */

import { useEffect, useState, useCallback } from "react";
import { SharedFileCard, type ReceivedGrant } from "@/components/SharedFileCard";

interface Metrics {
  totalUsers: number;
  totalStorageBytes: number;
  totalFiles: number;
  failedLogins: number;
  rateLimitBlocks: number;
  anomaliesDetected: number;
  activeGrants: number;
}

interface AdminAuditLog {
  id: string;
  user_id: string | null;
  wallet_address: string | null;
  event_type: string;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function shortAddress(addr: string | null): string {
  if (!addr) return "System / Guest";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function AdminDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [sharedFiles, setSharedFiles] = useState<ReceivedGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<string>("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/metrics");
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to load admin metrics." }));
        throw new Error(data.error || "Failed to load admin metrics.");
      }
      const data = await res.json();
      setMetrics(data.metrics);
      setAuditLogs(data.auditLogs);
      setSharedFiles(data.sharedWithAdmin);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading metrics.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredLogs = auditLogs.filter((log) => {
    if (eventFilter === "all") return true;
    return log.event_type === eventFilter;
  });

  if (loading && !metrics) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-gray-900 animate-pulse border border-gray-800" />
          ))}
        </div>
        <div className="h-64 rounded-2xl bg-gray-900 animate-pulse border border-gray-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-8 rounded-2xl bg-red-950/40 border border-red-800 text-center">
        <p className="text-xl mb-2">⚠️</p>
        <p className="text-red-300 font-semibold">{error}</p>
        <button
          onClick={loadData}
          className="mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-red-800 hover:bg-red-700 text-white transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ── Security Architecture Guarantee ────────────────────────────── */}
      <div className="p-4 rounded-2xl bg-indigo-950/30 border border-indigo-800/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🛡️</span>
          <div>
            <h2 className="text-sm font-semibold text-white">
              Zero-Knowledge Architecture Guarantee
            </h2>
            <p className="text-xs text-indigo-300 mt-0.5 leading-relaxed">
              The administrator has <strong>no master decryption key</strong> and cannot view private files.
              Files can only be read if a user explicitly creates a cryptographic access grant for this admin account.
            </p>
          </div>
        </div>
        <button
          onClick={loadData}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-indigo-700 text-indigo-200 hover:bg-indigo-900/40 transition-all flex items-center gap-1.5 flex-shrink-0"
        >
          <span>↻</span> Refresh Dashboard
        </button>
      </div>

      {/* ── Metric Cards ────────────────────────────────────────────────── */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="vault-card flex flex-col gap-1 border-gray-800">
            <span className="text-xs text-gray-500 font-medium">Total Registered Users</span>
            <span className="text-2xl font-bold text-white tracking-tight">{metrics.totalUsers}</span>
            <span className="text-[11px] text-emerald-400 mt-auto">SIWE Wallet Identities</span>
          </div>

          <div className="vault-card flex flex-col gap-1 border-gray-800">
            <span className="text-xs text-gray-500 font-medium">Ciphertext Storage</span>
            <span className="text-2xl font-bold text-white tracking-tight">
              {formatBytes(metrics.totalStorageBytes)}
            </span>
            <span className="text-[11px] text-gray-400 mt-auto">
              Across {metrics.totalFiles} encrypted files
            </span>
          </div>

          <div className="vault-card flex flex-col gap-1 border-gray-800">
            <span className="text-xs text-gray-500 font-medium">WAF / Rate-Limit Blocks</span>
            <span className="text-2xl font-bold text-amber-400 tracking-tight">
              {metrics.rateLimitBlocks}
            </span>
            <span className="text-[11px] text-amber-300/80 mt-auto">
              {metrics.failedLogins} failed login attempts
            </span>
          </div>

          <div className="vault-card flex flex-col gap-1 border-gray-800">
            <span className="text-xs text-gray-500 font-medium">Anomalies & Grants</span>
            <span className="text-2xl font-bold text-indigo-400 tracking-tight">
              {metrics.anomaliesDetected}
            </span>
            <span className="text-[11px] text-indigo-300 mt-auto">
              {metrics.activeGrants} active access grants
            </span>
          </div>
        </div>
      )}

      {/* ── Files Explicitly Shared with Admin ──────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>Files Shared with Admin</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-950 text-amber-400 border border-amber-800">
                Explicit Grants Only ({sharedFiles.length})
              </span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Files that users have explicitly opted to share with this admin wallet via ECDH key wrapping.
            </p>
          </div>
        </div>

        {sharedFiles.length === 0 ? (
          <div className="vault-card p-6 text-center text-xs text-gray-500 border-dashed border-gray-800">
            No files have been explicitly shared with the admin.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sharedFiles.map((grant) => (
              <SharedFileCard key={grant.grant_id} grant={grant} />
            ))}
          </div>
        )}
      </div>

      {/* ── System Audit Log Table ─────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">System Audit Log</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Append-only tamper-evident record of all logins, uploads, downloads, and security events.
            </p>
          </div>

          {/* Filter badges */}
          <div className="flex gap-1.5 flex-wrap">
            {["all", "login", "failed_login", "rate_limit_block", "anomaly", "upload", "download", "grant", "revoke"].map(
              (type) => (
                <button
                  key={type}
                  onClick={() => setEventFilter(type)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                    eventFilter === type
                      ? "bg-amber-600 text-white"
                      : "bg-gray-900 border border-gray-800 text-gray-400 hover:border-gray-700"
                  }`}
                >
                  {type.replace(/_/g, " ")}
                </button>
              )
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-gray-800 bg-gray-900/60">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-800 bg-gray-900/90 text-gray-400 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">User Wallet</th>
                <th className="px-4 py-3">IP Address</th>
                <th className="px-4 py-3">Details / Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60 font-mono">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500 font-sans">
                    No matching audit log events found.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isAnomaly = log.event_type === "anomaly";
                  const isBlock = log.event_type === "rate_limit_block" || log.event_type === "failed_login";

                  return (
                    <tr
                      key={log.id}
                      className={`hover:bg-gray-800/40 transition-colors ${
                        isAnomaly ? "bg-amber-950/20" : isBlock ? "bg-red-950/10" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            isAnomaly
                              ? "bg-amber-950 text-amber-300 border border-amber-800"
                              : isBlock
                              ? "bg-red-950 text-red-300 border border-red-800"
                              : "bg-gray-800 text-gray-300"
                          }`}
                        >
                          {log.event_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                        {shortAddress(log.wallet_address)}
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {log.ip_address || "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-400 max-w-xs truncate">
                        {log.metadata ? JSON.stringify(log.metadata) : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
