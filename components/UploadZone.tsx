"use client";

/**
 * components/UploadZone.tsx
 *
 * Drag-and-drop file uploader with full in-browser encryption pipeline:
 *
 *   1. User drops files
 *   2. Hook prompts wallet for key-derivation signature (once per session)
 *   3. Each file is AES-256-GCM encrypted in-browser via lib/crypto.ts
 *   4. SHA-256 hash of ciphertext is computed (for integrity)
 *   5. Ciphertext blob + metadata POSTed to /api/files
 *   6. Server streams to S3 — no plaintext ever leaves the browser
 *
 * Security guarantee: the CryptoKey is non-extractable and lives only in
 * React state. Neither the key nor the plaintext is ever serialised or sent
 * to the server.
 */

import { useCallback, useRef, useState } from "react";
import { encryptFile, bufferToBase64 } from "@/lib/crypto";
import { useFileKey } from "@/hooks/useFileKey";

interface FileItem {
  id: string;
  file: File;
  status: "queued" | "encrypting" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
  fileId?: string;
}

export function UploadZone() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { keyState, deriveKey } = useFileKey();

  // ── Update a single item by id ──────────────────────────────────────────
  function updateItem(id: string, patch: Partial<FileItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  // ── Add files to the queue ─────────────────────────────────────────────
  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const newItems: FileItem[] = Array.from(fileList).map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "queued",
      progress: 0,
    }));
    setItems((prev) => [...prev, ...newItems]);
  }

  // ── Drag and drop handlers ─────────────────────────────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setIsDragging(false), []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Encrypt + upload a single file ────────────────────────────────────
  async function processFile(item: FileItem, key: CryptoKey) {
    try {
      // Step 1: Encrypt in-browser
      updateItem(item.id, { status: "encrypting", progress: 10 });
      const { ciphertext, iv, sha256Hex } = await encryptFile(item.file, key);

      updateItem(item.id, { progress: 40 });

      // Step 2: Encrypt the file name (simple base64 of AES-GCM encrypted name)
      // Using a separate IV for the name so it doesn't leak patterns
      const nameIv = crypto.getRandomValues(new Uint8Array(12));
      const encryptedNameBuf = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nameIv },
        key,
        new TextEncoder().encode(item.file.name)
      );
      // Store as "base64iv:base64ciphertext"
      const encryptedName = `${bufferToBase64(nameIv.buffer as ArrayBuffer)}:${bufferToBase64(encryptedNameBuf)}`;

      updateItem(item.id, { progress: 50 });

      // Step 3: Build FormData — send ciphertext blob + metadata
      // The server only ever sees encrypted content.
      const form = new FormData();
      form.append("encryptedName", encryptedName);
      form.append("ciphertextHash", sha256Hex);
      form.append("iv", bufferToBase64(iv.buffer as ArrayBuffer));
      form.append("sizeBytes", String(ciphertext.byteLength));
      if (item.file.type) form.append("mimeType", item.file.type);
      form.append(
        "ciphertext",
        new File([ciphertext], "blob", { type: "application/octet-stream" })
      );

      // Step 4: Upload to backend
      updateItem(item.id, { status: "uploading", progress: 60 });
      const res = await fetch("/api/files", { method: "POST", body: form });

      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Upload failed." }));
        throw new Error(error ?? "Upload failed.");
      }

      const { fileId } = await res.json();
      updateItem(item.id, { status: "done", progress: 100, fileId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error.";
      updateItem(item.id, { status: "error", error: msg });
    }
  }

  // ── Start encryption + upload for all queued items ─────────────────────
  async function startUpload() {
    const queued = items.filter((it) => it.status === "queued");
    if (queued.length === 0) return;

    // Derive (or reuse) the file key — prompts wallet once per session
    const key = await deriveKey();
    if (!key) return; // user rejected or error — keyState has the message

    // Process files sequentially to avoid overwhelming the browser's crypto
    for (const item of queued) {
      await processFile(item, key);
    }
  }

  const queuedCount = items.filter((i) => i.status === "queued").length;
  const doneCount = items.filter((i) => i.status === "done").length;
  const hasQueued = queuedCount > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Key derivation status banner */}
      {keyState.status === "signing" && (
        <div className="px-4 py-3 rounded-xl bg-indigo-950 border border-indigo-700 text-indigo-200 text-sm flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
          Check your wallet — sign to derive your encryption key…
        </div>
      )}
      {keyState.status === "error" && (
        <div className="px-4 py-3 rounded-xl bg-red-950/80 border border-red-700 text-red-200 text-sm flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{keyState.message}</span>
          </div>
          <button
            onClick={() => deriveKey()}
            className="px-3 py-1 bg-red-800 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shrink-0 transition-colors"
          >
            Reconnect & Sign
          </button>
        </div>
      )}
      {keyState.status === "ready" && (
        <div className="px-4 py-3 rounded-xl bg-emerald-950 border border-emerald-700 text-emerald-200 text-sm flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          Encryption key ready — files will be encrypted in your browser before upload.
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 p-12
          flex flex-col items-center justify-center gap-4 text-center select-none
          ${isDragging
            ? "border-indigo-400 bg-indigo-950/40"
            : "border-gray-700 bg-gray-900/40 hover:border-gray-500 hover:bg-gray-900/60"
          }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => addFiles(e.target.files)}
        />
        <div className="w-14 h-14 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center text-2xl">
          🔒
        </div>
        <div>
          <p className="font-semibold text-gray-200">
            {isDragging ? "Drop to encrypt & upload" : "Drag & drop files here"}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            or click to browse — files are encrypted in your browser before upload
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-center">
          {["AES-256-GCM", "HKDF key", "Zero-knowledge"].map((label) => (
            <span key={label} className="badge-encrypted">{label}</span>
          ))}
        </div>
      </div>

      {/* File list */}
      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <FileRow
              key={item.id}
              item={item}
              onRemove={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
            />
          ))}
        </div>
      )}

      {/* Upload button */}
      {hasQueued && (
        <button
          onClick={startUpload}
          disabled={keyState.status === "signing"}
          className="self-end px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500
                     text-white font-semibold transition-all duration-150
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {keyState.status === "signing"
            ? "Waiting for wallet…"
            : `Encrypt & Upload ${queuedCount} file${queuedCount !== 1 ? "s" : ""}`}
        </button>
      )}

      {/* Summary */}
      {doneCount > 0 && (
        <p className="text-sm text-emerald-400">
          ✓ {doneCount} file{doneCount !== 1 ? "s" : ""} encrypted and uploaded.{" "}
          <a href="/app/files" className="underline hover:text-emerald-300">
            View your vault →
          </a>
        </p>
      )}
    </div>
  );
}

// ── Per-file row component ───────────────────────────────────────────────

function FileRow({ item, onRemove }: { item: FileItem; onRemove: () => void }) {
  const sizeMB = (item.file.size / 1024 / 1024).toFixed(2);

  const statusConfig: Record<FileItem["status"], { label: string; color: string }> = {
    queued:     { label: "Queued",     color: "text-gray-400" },
    encrypting: { label: "Encrypting…", color: "text-indigo-400" },
    uploading:  { label: "Uploading…", color: "text-blue-400" },
    done:       { label: "Uploaded ✓", color: "text-emerald-400" },
    error:      { label: "Error",      color: "text-red-400" },
  };

  const { label, color } = statusConfig[item.status];

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900 border border-gray-800">
      {/* Icon */}
      <span className="text-lg flex-shrink-0">
        {item.status === "done" ? "✅" : item.status === "error" ? "❌" : "📄"}
      </span>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-200 truncate">{item.file.name}</p>
        <p className="text-xs text-gray-500">{sizeMB} MB</p>

        {/* Progress bar */}
        {(item.status === "encrypting" || item.status === "uploading") && (
          <div className="mt-1.5 h-1 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}

        {/* Error message */}
        {item.status === "error" && item.error && (
          <p className="text-xs text-red-400 mt-0.5">{item.error}</p>
        )}
      </div>

      {/* Status */}
      <span className={`text-xs font-medium flex-shrink-0 ${color}`}>{label}</span>

      {/* Remove button (only for queued/error) */}
      {(item.status === "queued" || item.status === "error") && (
        <button
          onClick={onRemove}
          className="text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0"
          aria-label="Remove"
        >
          ✕
        </button>
      )}
    </div>
  );
}
