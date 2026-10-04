// app/app/layout.tsx — shared layout for all /app/* protected pages
// Renders the top navigation bar with wallet address + sign-out.

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { headers } from "next/headers";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Short address for display
  const addr = session.address;
  const shortAddr = `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  // Read injected header from middleware (avoids re-verifying JWT)
  const headersList = await headers();
  const role = headersList.get("x-user-role") ?? session.role;

  return (
    <div className="min-h-screen flex flex-col bg-gray-950 text-gray-100">
      {/* Top nav */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-md sticky top-0 z-40">
        <nav className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
          {/* Brand */}
          <Link href="/app/dashboard" className="flex items-center gap-2 mr-4">
            <span className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white" stroke="currentColor" strokeWidth={2.5}>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <span className="font-bold text-sm text-white hidden sm:block">SecureVault</span>
          </Link>

          {/* Nav links */}
          <Link href="/app/upload"   className="nav-link">Upload</Link>
          <Link href="/app/files"    className="nav-link">Files</Link>
          <Link href="/app/security" className="nav-link">Security</Link>
          <Link href="/app/profile"  className="nav-link">Profile</Link>
          {role === "admin" && (
            <Link href="/admin" className="nav-link text-amber-400">Admin</Link>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Wallet badge */}
          <span className="text-xs text-gray-400 font-mono hidden sm:block">{shortAddr}</span>
          <SignOutButton />
        </nav>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        {children}
      </main>
    </div>
  );
}
