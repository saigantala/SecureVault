// hooks/useFileKey.ts
// React hook that derives and caches the AES-256-GCM file-encryption key
// for the currently signed-in wallet.
//
// The key derivation requires the user to sign a deterministic message with
// their wallet — the same wallet always produces the same key via HKDF.
//
// Security:
//   - The resulting CryptoKey is marked non-extractable
//   - It is stored only in React state (gone on page refresh → sign again)
//   - The wallet signature used for derivation is NEVER sent to the server
//   - This is completely separate from the SIWE auth signature

"use client";

import { useState } from "react";
import { useSignMessage } from "wagmi";
import { deriveFileKey } from "@/lib/crypto";

type KeyState =
  | { status: "idle" }
  | { status: "signing" }
  | { status: "ready"; key: CryptoKey }
  | { status: "error"; message: string };

const KEY_DERIVATION_MESSAGE =
  "SecureVault: I authorize key derivation for my encrypted vault. This signature is not a transaction.";

export function useFileKey() {
  const [keyState, setKeyState] = useState<KeyState>({ status: "idle" });
  const { signMessageAsync } = useSignMessage();

  async function deriveKey(): Promise<CryptoKey | null> {
    if (keyState.status === "ready") return keyState.key;

    setKeyState({ status: "signing" });
    try {
      // Ask the connected wallet to sign
      const signature = await signMessageAsync({ message: KEY_DERIVATION_MESSAGE });

      // Derive the AES-256-GCM key from the signature via HKDF
      const key = await deriveFileKey(signature);

      setKeyState({ status: "ready", key });
      return key;
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message.toLowerCase().includes("user rejected")
            ? "Signature cancelled."
            : err.message
          : "Key derivation failed.";
      setKeyState({ status: "error", message: msg });
      return null;
    }
  }

  function resetKey() {
    setKeyState({ status: "idle" });
  }

  return { keyState, deriveKey, resetKey };
}
