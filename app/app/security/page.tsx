// app/app/security/page.tsx — /app/security (replaces placeholder)
// Shows the signed-in user their own audit_log entries.

import { SecurityLog } from "@/components/SecurityLog";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security Log — SecureVault" };

export default async function SecurityPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const addr = session.address;
  const shortAddr = `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Security Log</h1>
        <p className="text-gray-400 mt-1 text-sm leading-relaxed">
          Every login, upload, download, and grant for wallet{" "}
          <span className="font-mono text-indigo-400">{shortAddr}</span>.
          Anomalies are highlighted.
        </p>
      </div>

      {/* Guarantee strip */}
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        {[
          {
            icon: "📋",
            title: "Immutable log",
            desc: "Every security event is appended to audit_log — rows are never updated or deleted.",
          },
          {
            icon: "🔔",
            title: "Email alerts",
            desc: "Configure your email below to get notified when a new IP or device signs in.",
          },
          {
            icon: "🛡",
            title: "Per-account only",
            desc: "Anomalies flag your session for re-auth. The app is never globally locked.",
          },
        ].map(({ icon, title, desc }) => (
          <div key={title} className="px-4 py-3 rounded-xl bg-gray-900 border border-gray-800">
            <div className="flex items-center gap-2 mb-1">
              <span>{icon}</span>
              <span className="font-semibold text-gray-200 text-sm">{title}</span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* Anomaly re-auth note (shown if session has anomaly flag) */}
      {session?.anomaly && (
        <div className="px-4 py-3 rounded-xl bg-amber-950 border border-amber-700
                        text-amber-200 text-sm flex items-start gap-2">
          <span className="mt-0.5">⚠️</span>
          <div>
            <strong>This session was flagged.</strong> We detected a sign-in from a new
            location or device. If this wasn&apos;t you, please review the log below and
            contact support.
          </div>
        </div>
      )}

      {/* Security log */}
      <SecurityLog />
    </div>
  );
}
