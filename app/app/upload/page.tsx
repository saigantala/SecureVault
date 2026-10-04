// app/app/upload/page.tsx — /app/upload (protected, replaces placeholder)
// Drag-and-drop upload page. All encryption happens client-side before upload.

import { UploadZone } from "@/components/UploadZone";

export const metadata = { title: "Upload — SecureVault" };

export default function UploadPage() {
  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Upload Files</h1>
        <p className="text-gray-400 mt-1 text-sm leading-relaxed">
          Files are <span className="text-indigo-400 font-medium">AES-256-GCM encrypted in your browser</span> before
          they leave your device. The server only ever receives ciphertext.
        </p>
      </div>

      {/* How it works */}
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        {[
          {
            step: "1",
            title: "Key derived",
            desc: "HKDF from your wallet signature — deterministic, never stored.",
          },
          {
            step: "2",
            title: "Encrypted",
            desc: "AES-256-GCM in your browser. Plaintext never leaves your device.",
          },
          {
            step: "3",
            title: "Uploaded",
            desc: "Only ciphertext reaches our servers and is stored in S3.",
          },
        ].map(({ step, title, desc }) => (
          <div
            key={step}
            className="px-4 py-3 rounded-xl bg-gray-900 border border-gray-800"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">
                {step}
              </span>
              <span className="font-semibold text-gray-200">{title}</span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* Upload widget */}
      <UploadZone />
    </div>
  );
}
