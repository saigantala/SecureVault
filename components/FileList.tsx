"use client";

/**
 * components/FileList.tsx
 *
 * Client component that:
 *   1. Fetches the user's file list from GET /api/files
 *   2. Prompts for key derivation (one wallet signature) before any download
 *   3. Renders <FileCard> for each file
 *   4. Handles empty state, loading state, and error state
 *
 * The key derivation is shared across all cards — one signature unlocks
 * all files for the session (they all use the same deterministic HKDF key).
 */

import { useEffect, useState } from "react";
import { useFileKey } from "@/hooks/useFileKey";
import { FileCard, type FileRow } from "@/components/FileCard";
import { SharedFileCard, type ReceivedGrant } from "@/components/SharedFileCard";
import Link from "next/link";

export function FileList() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [receivedGrants, setReceivedGrants] = useState<ReceivedGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { keyState, deriveKey } = useFileKey();
  const fileKey = keyState.status === "ready" ? keyState.key : null;

  // ── Fetch file list & received grants ────────────────────────────────────
  useEffect(() => {
    async function loadFiles() {
      try {
        const [filesRes, grantsRes] = await Promise.all([
          fetch("/api/files"),
          fetch("/api/grants?received=true"),
        ]);

        if (!filesRes.ok) throw new Error("Failed to load files.");
        const data = await filesRes.json();
        setFiles(data.files ?? []);

        if (grantsRes.ok) {
          const grantsData = await grantsRes.json();
          setReceivedGrants(grantsData.receivedGrants ?? []);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unknown error.");
      } finally {
        setLoading(false);
      }
    }
    loadFiles();
  }, []);

  function handleDeleted(fileId: string) {
    setFiles((prev) => prev.filter((f) => f.file_id !== fileId));
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="vault-card h-24 animate-pulse bg-gray-900/60"
          />
        ))}
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="px-4 py-6 rounded-xl bg-red-950 border border-red-800 text-red-200 text-sm text-center">
        <p className="text-lg mb-1">⚠️</p>
        <p>{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 text-xs underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (files.length === 0 && receivedGrants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center text-3xl">
          🔒
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-200">Your vault is empty</h2>
          <p className="text-sm text-gray-500 mt-1">
            Upload your first file to get started.
          </p>
        </div>
        <Link
          href="/app/upload"
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500
                     text-white font-semibold text-sm transition-all"
        >
          Upload a file
        </Link>
      </div>
    );
  }

  // ── File list ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Key derivation section */}
      <div className="px-4 py-3 rounded-xl border flex items-center gap-3
                      flex-wrap
                      border-gray-800 bg-gray-900/60">
        {keyState.status === "idle" && (
          <>
            <div>
              <p className="text-sm font-medium text-gray-200">Unlock your vault</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Sign a message with your wallet to derive your decryption key — then download any file.
              </p>
            </div>
            <button
              onClick={() => deriveKey()}
              className="ml-auto flex-shrink-0 px-4 py-2 rounded-lg
                         bg-indigo-600 hover:bg-indigo-500 text-white text-sm
                         font-semibold transition-all"
            >
              Unlock vault
            </button>
          </>
        )}

        {keyState.status === "signing" && (
          <div className="flex items-center gap-2 text-sm text-indigo-300">
            <span className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
            Check your wallet — sign to derive your decryption key…
          </div>
        )}

        {keyState.status === "ready" && (
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Vault unlocked — click any file to decrypt and download.
          </div>
        )}

        {keyState.status === "error" && (
          <div className="flex items-center gap-3 w-full">
            <p className="text-sm text-red-300 flex-1">⚠️ {keyState.message}</p>
            <button
              onClick={() => deriveKey()}
              className="text-xs underline text-red-400 hover:no-underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 text-xs text-gray-500 flex-wrap">
        <span>{files.length} file{files.length !== 1 ? "s" : ""}</span>
        <span>·</span>
        <span>
          {(files.reduce((acc, f) => acc + (f.size_bytes || 0), 0) / 1024 / 1024).toFixed(2)} MB
          total (ciphertext)
        </span>
        <span>·</span>
        <span className="text-emerald-600">All encrypted</span>
      </div>

      {/* File cards */}
      {files.length > 0 && (
        <div className="flex flex-col gap-3">
          {files.map((file) => (
            <FileCard
              key={file.file_id}
              file={file}
              fileKey={fileKey}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}

      {/* Shared with you section */}
      {receivedGrants.length > 0 && (
        <div className="flex flex-col gap-3 pt-4 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-200">
              Shared with you ({receivedGrants.length})
            </h2>
            <span className="text-xs text-indigo-400">ECDH End-to-End Decryption</span>
          </div>

          <div className="flex flex-col gap-3">
            {receivedGrants.map((grant) => (
              <SharedFileCard key={grant.grant_id} grant={grant} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
