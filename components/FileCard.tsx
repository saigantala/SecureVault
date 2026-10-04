"use client";

/**
 * components/FileCard.tsx
 *
 * Renders a single file row with:
 *   - Encrypted status badge
 *   - Decrypt & download button (calls useDecryptDownload)
 *   - Version history drawer (fetches /api/files/[id]/versions)
 *   - Delete button (soft-delete)
 *
 * The file name is shown as "Encrypted" until the user has a key
 * and explicitly downloads — we never store or display plaintext names.
 */

import { useState } from "react";
import { useDecryptDownload } from "@/hooks/useDecryptDownload";
import { ShareModal } from "@/components/ShareModal";

export interface FileRow {
  file_id: string;
  encrypted_name: string;
  mime_type: string | null;
  created_at: string;
  version_no: number;
  ciphertext_hash: string;
  s3_pointer: string;
  size_bytes: number;
  iv: string;
  prev_hash: string | null;
}

interface VersionRow {
  id: string;
  version_no: number;
  ciphertext_hash: string;
  prev_hash: string | null;
  size_bytes: number;
  onchain_tx_hash: string | null;
  created_at: string;
}

interface FileCardProps {
  file: FileRow;
  fileKey: CryptoKey | null;
  onDeleted: (fileId: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function FileCard({ file, fileKey, onDeleted }: FileCardProps) {
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>();
  const [showShare, setShowShare] = useState(false);

  const { downloadState, download } = useDecryptDownload();

  const isDownloading =
    downloadState.status === "fetching" || downloadState.status === "decrypting";

  // ── Load version history ────────────────────────────────────────────────
  async function loadVersions() {
    if (showVersions) {
      setShowVersions(false);
      return;
    }
    setVersionsLoading(true);
    try {
      const res = await fetch(`/api/files/${file.file_id}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions);
      }
    } finally {
      setVersionsLoading(false);
      setShowVersions(true);
    }
  }

  // ── Decrypt + download ──────────────────────────────────────────────────
  async function handleDownload(versionNo?: number) {
    if (!fileKey) return;
    setSelectedVersion(versionNo);
    await download(file.file_id, file.encrypted_name, fileKey, versionNo);
  }

  // ── Soft-delete ─────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!confirm("Delete this file? It can be recovered within the grace period.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/files/${file.file_id}`, { method: "DELETE" });
      if (res.ok) onDeleted(file.file_id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="vault-card flex flex-col gap-4">
      {/* ── File header row ─────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        {/* File icon */}
        <div className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-700 flex items-center
                        justify-center text-lg flex-shrink-0">
          📄
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Encrypted name badge — plaintext never shown here */}
            <span className="text-sm font-medium text-gray-200">
              {fileKey ? (
                <span className="italic text-gray-400 text-xs">
                  🔒 Encrypted — download to reveal
                </span>
              ) : (
                <span className="italic text-gray-500 text-xs">
                  🔒 Derive key to reveal filename
                </span>
              )}
            </span>
            <span className="badge-encrypted">Encrypted</span>
            <span className="text-xs text-gray-600 font-mono">v{file.version_no}</span>
          </div>
          <div className="flex gap-3 mt-1 text-xs text-gray-500 flex-wrap">
            <span>{formatBytes(file.size_bytes)}</span>
            <span>·</span>
            <span>{formatDate(file.created_at)}</span>
            <span>·</span>
            <span className="font-mono truncate max-w-[160px]" title={file.ciphertext_hash}>
              sha256: {file.ciphertext_hash.slice(0, 12)}…
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Download latest */}
          <button
            onClick={() => handleDownload()}
            disabled={!fileKey || isDownloading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium
                       bg-indigo-600 hover:bg-indigo-500 text-white
                       transition-all disabled:opacity-40 disabled:cursor-not-allowed
                       flex items-center gap-1.5"
          >
            {isDownloading && selectedVersion === undefined ? (
              <>
                <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                {downloadState.status === "fetching" ? "Fetching…" : "Decrypting…"}
              </>
            ) : downloadState.status === "done" && selectedVersion === undefined ? (
              "Downloaded ✓"
            ) : (
              "↓ Download"
            )}
          </button>

          {/* Version history */}
          <button
            onClick={loadVersions}
            disabled={versionsLoading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium
                       border border-gray-700 text-gray-400
                       hover:border-gray-500 hover:text-gray-200
                       transition-all disabled:opacity-40"
          >
            {versionsLoading ? "…" : showVersions ? "Hide history" : `History`}
          </button>

          {/* Share */}
          <button
            onClick={() => setShowShare(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium
                       border border-gray-700 text-gray-400
                       hover:border-indigo-600 hover:text-indigo-400
                       transition-all"
          >
            Share
          </button>

          {/* Delete */}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 py-1.5 rounded-lg text-xs font-medium
                       border border-gray-700 text-red-500
                       hover:border-red-800 hover:bg-red-950/40
                       transition-all disabled:opacity-40"
          >
            {deleting ? "…" : "Delete"}
          </button>
        </div>
      </div>

      {/* Share modal */}
      {showShare && (
        <ShareModal
          fileId={file.file_id}
          onClose={() => setShowShare(false)}
          onGranted={() => setShowShare(false)}
        />
      )}

      {/* Error state */}
      {downloadState.status === "error" && (
        <div className="px-3 py-2 rounded-lg bg-red-950 border border-red-800 text-red-200 text-xs">
          ⚠️ {downloadState.error}
        </div>
      )}

      {/* ── Version history drawer ──────────────────────────────────────── */}
      {showVersions && versions.length > 0 && (
        <div className="border-t border-gray-800 pt-4 flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Version history — hash chain
          </p>

          {versions.map((v, idx) => (
            <div
              key={v.id}
              className="flex items-start gap-3 px-3 py-2.5 rounded-lg
                         bg-gray-950 border border-gray-800 text-xs"
            >
              {/* Chain indicator */}
              <div className="flex flex-col items-center gap-1 pt-0.5">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                  ${idx === 0 ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                  v{v.version_no}
                </span>
                {idx < versions.length - 1 && (
                  <div className="w-px h-4 bg-gray-700" />
                )}
              </div>

              {/* Hash info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-gray-300 truncate">
                    {v.ciphertext_hash.slice(0, 16)}…
                  </span>
                  {v.onchain_tx_hash && (
                    <span className="badge-syncing">⛓ On-chain</span>
                  )}
                  {idx === 0 && (
                    <span className="badge-encrypted">Latest</span>
                  )}
                </div>
                <div className="flex gap-2 mt-0.5 text-gray-500 flex-wrap">
                  <span>{formatBytes(v.size_bytes)}</span>
                  <span>·</span>
                  <span>{formatDate(v.created_at)}</span>
                  {v.prev_hash && (
                    <>
                      <span>·</span>
                      <span className="font-mono">
                        ← {v.prev_hash.slice(0, 10)}…
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Download specific version */}
              <button
                onClick={() => handleDownload(v.version_no)}
                disabled={!fileKey || isDownloading}
                className="px-2 py-1 rounded text-[10px] font-medium
                           border border-gray-700 text-gray-400
                           hover:border-indigo-600 hover:text-indigo-400
                           transition-all disabled:opacity-40 flex-shrink-0"
              >
                {isDownloading && selectedVersion === v.version_no
                  ? "…"
                  : "↓ v" + v.version_no}
              </button>
            </div>
          ))}

          {/* Hash chain integrity note */}
          <p className="text-[10px] text-gray-600 mt-1">
            ← each version records the previous version&apos;s hash, forming a tamper-evident chain.
          </p>
        </div>
      )}
    </div>
  );
}
