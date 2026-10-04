// app/login/page.tsx — /login route
// Public page. If already signed in, redirects to /app/dashboard.

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ConnectWallet } from "@/components/ConnectWallet";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Sign In — SecureVault",
};

interface LoginPageProps {
  searchParams: Promise<{ from?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // Already authenticated → skip the login page
  const session = await getSession();
  if (session) redirect("/app/dashboard");

  const { from } = await searchParams;
  const redirectTo = from?.startsWith("/app") || from?.startsWith("/admin")
    ? from
    : "/app/dashboard";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4
                      bg-gray-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))]
                      from-indigo-950/40 via-gray-950 to-gray-950">
      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900/80
                      backdrop-blur-md shadow-2xl shadow-black/50 p-8 flex flex-col items-center gap-8">

        {/* Logo / wordmark */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center
                          shadow-lg shadow-indigo-900/60">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-white" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">SecureVault</h1>
          <p className="text-sm text-gray-400 text-center leading-relaxed">
            Zero-knowledge encrypted file storage.<br />
            Your files never leave your browser unencrypted.
          </p>
        </div>

        {/* Security badge strip */}
        <div className="flex flex-wrap gap-2 justify-center">
          {["AES-256-GCM", "Zero-Knowledge", "Wallet Auth"].map((label) => (
            <span
              key={label}
              className="px-2 py-0.5 rounded-full text-[11px] font-medium
                         bg-indigo-950 text-indigo-300 border border-indigo-800"
            >
              {label}
            </span>
          ))}
        </div>

        {/* Wallet connect widget */}
        <ConnectWallet redirectTo={redirectTo} />

        {/* Footer */}
        <p className="text-xs text-gray-600 text-center leading-relaxed">
          Signing a message proves wallet ownership.<br />
          No private key is ever shared with this server.
        </p>
      </div>
    </main>
  );
}
