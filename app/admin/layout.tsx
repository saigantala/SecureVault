// app/admin/layout.tsx — layout for admin dashboard
// Enforces role === 'admin' server-side and provides admin navigation.

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/app/dashboard");

  const shortAddr = `${session.address.slice(0, 6)}…${session.address.slice(-4)}`;

  return (
    <div className="min-h-screen flex flex-col bg-gray-950 text-gray-100">
      {/* Top Admin Header */}
      <header className="border-b border-amber-900/40 bg-gray-950/90 backdrop-blur-md sticky top-0 z-40">
        <nav className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          <Link href="/admin" className="flex items-center gap-2 mr-3">
            <span className="w-7 h-7 rounded-lg bg-amber-600 flex items-center justify-center font-bold text-white text-xs shadow-md shadow-amber-900/40">
              ⚡
            </span>
            <span className="font-bold text-sm text-white">SecureVault Admin</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950 text-amber-400 border border-amber-800">
              Zero-Knowledge Admin
            </span>
          </Link>

          <Link
            href="/app/dashboard"
            className="text-xs text-gray-400 hover:text-gray-100 transition-colors px-2 py-1 rounded-md border border-gray-800 hover:border-gray-700 bg-gray-900/50"
          >
            ← Back to User Vault
          </Link>

          <div className="flex-1" />

          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-gray-400 hidden sm:inline">
              {shortAddr}
            </span>
            <SignOutButton />
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        {children}
      </main>
    </div>
  );
}
