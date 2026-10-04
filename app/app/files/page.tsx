// app/app/files/page.tsx — /app/files (replaces placeholder)
// Encrypted file vault list with in-browser decrypt/download.

import { FileList } from "@/components/FileList";

export const metadata = { title: "My Files — SecureVault" };

export default function FilesPage() {
  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">My Files</h1>
        <p className="text-gray-400 mt-1 text-sm leading-relaxed">
          All files are stored as ciphertext. Decryption happens{" "}
          <span className="text-indigo-400 font-medium">entirely in your browser</span> — nothing is sent back to the server.
        </p>
      </div>

      {/* How download works */}
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        {[
          {
            step: "1",
            title: "Presigned URL",
            desc: "Server generates a 5-min link. Your browser fetches ciphertext straight from S3.",
          },
          {
            step: "2",
            title: "Integrity check",
            desc: "SHA-256 of the downloaded blob is verified against the DB hash before decryption.",
          },
          {
            step: "3",
            title: "Decrypted locally",
            desc: "AES-256-GCM decryption in your browser. Plaintext triggers the save dialog directly.",
          },
        ].map(({ step, title, desc }) => (
          <div
            key={step}
            className="px-4 py-3 rounded-xl bg-gray-900 border border-gray-800"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs
                               flex items-center justify-center font-bold">
                {step}
              </span>
              <span className="font-semibold text-gray-200">{title}</span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* File list */}
      <FileList />
    </div>
  );
}
