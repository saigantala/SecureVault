"use client";

// components/SignOutButton.tsx
// Client component that POSTs to /api/auth/logout and redirects to /login.

import { useRouter } from "next/navigation";
import { useDisconnect } from "wagmi";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const { disconnect } = useDisconnect();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    disconnect();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      disabled={loading}
      className="px-3 py-1.5 rounded-lg text-xs font-medium
                 border border-gray-700 text-gray-400
                 hover:border-gray-500 hover:text-gray-200
                 transition-all duration-150 disabled:opacity-50"
    >
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}
