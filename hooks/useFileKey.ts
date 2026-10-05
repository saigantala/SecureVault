// hooks/useFileKey.ts
// React hook that derives and caches the AES-256-GCM file-encryption key
// for the currently signed-in wallet.
//
// Includes 3-tier fallback to eliminate "Connector not connected" errors:
//   Tier 1: Active Wagmi signMessageAsync
//   Tier 2: Automatic silent reconnect to connector + sign
//   Tier 3: Direct EIP-1193 window.ethereum personal_sign (100% reliable with MetaMask extension)

"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { deriveFileKey } from "@/lib/crypto";
import { stringToHex } from "viem";

type KeyState =
  | { status: "idle" }
  | { status: "signing" }
  | { status: "ready"; key: CryptoKey }
  | { status: "error"; message: string };

const KEY_DERIVATION_MESSAGE =
  "SecureVault: I authorize key derivation for my encrypted vault. This signature is not a transaction.";

// Session-level in-memory cache so user doesn't have to re-sign on every page navigation
const sessionKeyCache = new Map<string, CryptoKey>();

export function useFileKey() {
  const { address, isConnected, connector } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { signMessageAsync } = useSignMessage();

  const [keyState, setKeyState] = useState<KeyState>(() => {
    if (address && sessionKeyCache.has(address.toLowerCase())) {
      return { status: "ready", key: sessionKeyCache.get(address.toLowerCase())! };
    }
    return { status: "idle" };
  });

  // Check cache whenever address changes
  useEffect(() => {
    if (address) {
      const cached = sessionKeyCache.get(address.toLowerCase());
      if (cached) {
        setKeyState({ status: "ready", key: cached });
      }
    }
  }, [address]);

  const deriveKey = useCallback(async (): Promise<CryptoKey | null> => {
    // 0. Check in-memory session cache first
    if (address && sessionKeyCache.has(address.toLowerCase())) {
      const cached = sessionKeyCache.get(address.toLowerCase())!;
      setKeyState({ status: "ready", key: cached });
      return cached;
    }

    if (keyState.status === "ready") return keyState.key;

    setKeyState({ status: "signing" });

    try {
      let signature: `0x${string}` | null = null;
      let signingAddress = address;

      // ── Tier 1: Try Wagmi signMessageAsync if actively connected ───
      if (isConnected && connector) {
        try {
          signature = (await signMessageAsync({ message: KEY_DERIVATION_MESSAGE })) as `0x${string}`;
        } catch (wagmiErr: unknown) {
          const errMsg = wagmiErr instanceof Error ? wagmiErr.message : String(wagmiErr);
          if (errMsg.toLowerCase().includes("user rejected") || errMsg.toLowerCase().includes("denied")) {
            throw new Error("Signature cancelled in wallet.");
          }
          console.warn("[useFileKey] Wagmi signMessage failed, attempting auto-reconnect/fallback:", errMsg);
        }
      }

      // ── Tier 2: Attempt auto-reconnect with available connector ───
      if (!signature) {
        const targetConnector =
          connectors.find((c) => c.id === "metaMask") ||
          connectors.find((c) => c.name.toLowerCase().includes("metamask")) ||
          connectors[0];

        if (targetConnector) {
          try {
            const res = await connectAsync({ connector: targetConnector });
            if (res.accounts?.[0]) signingAddress = res.accounts[0];
            signature = (await signMessageAsync({ message: KEY_DERIVATION_MESSAGE })) as `0x${string}`;
          } catch (connErr: unknown) {
            const errMsg = connErr instanceof Error ? connErr.message : String(connErr);
            if (errMsg.toLowerCase().includes("user rejected") || errMsg.toLowerCase().includes("denied")) {
              throw new Error("Signature cancelled in wallet.");
            }
            console.warn("[useFileKey] Connector auto-reconnect failed, trying direct EIP-1193 fallback:", errMsg);
          }
        }
      }

      // ── Tier 3: Direct EIP-1193 window.ethereum personal_sign (MetaMask extension) ───
      if (!signature && typeof window !== "undefined") {
        const eth = (window as unknown as { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<unknown> } }).ethereum;
        if (eth) {
          try {
            const accounts = (await eth.request({ method: "eth_requestAccounts", params: [] })) as string[];
            const targetAddr = (Array.isArray(accounts) && accounts[0]) || signingAddress;
            if (!targetAddr) {
              throw new Error("No active wallet account found. Please unlock MetaMask.");
            }
            signingAddress = targetAddr as `0x${string}`;
            const hexMessage = stringToHex(KEY_DERIVATION_MESSAGE);
            signature = (await eth.request({
              method: "personal_sign",
              params: [hexMessage, targetAddr],
            })) as `0x${string}`;
          } catch (ethErr: unknown) {
            const errMsg = ethErr instanceof Error ? ethErr.message : String(ethErr);
            if (errMsg.toLowerCase().includes("user rejected") || errMsg.toLowerCase().includes("denied")) {
              throw new Error("Signature cancelled in wallet.");
            }
            throw ethErr;
          }
        }
      }

      if (!signature) {
        throw new Error("Could not connect to wallet. Please verify your MetaMask extension is unlocked and connected.");
      }

      // Derive the AES-256-GCM key from the signature via HKDF
      const key = await deriveFileKey(signature);

      // Cache in session memory
      if (signingAddress) {
        sessionKeyCache.set(signingAddress.toLowerCase(), key);
      }

      setKeyState({ status: "ready", key });
      return key;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Key derivation failed.";
      setKeyState({ status: "error", message: msg });
      return null;
    }
  }, [address, isConnected, connector, connectors, connectAsync, signMessageAsync, keyState]);

  function resetKey() {
    if (address) sessionKeyCache.delete(address.toLowerCase());
    setKeyState({ status: "idle" });
  }

  return { keyState, deriveKey, resetKey };
}
