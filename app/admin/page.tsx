// app/admin/page.tsx — /admin (protected, admin role only)
import { AdminDashboard } from "@/components/AdminDashboard";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin Dashboard — SecureVault",
  description: "Administrative metrics and system audit log. Zero-Knowledge enforcement active.",
};

export default function AdminPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Admin Overview</h1>
        <p className="text-gray-400 mt-1 text-sm">
          High-level telemetry, security incident monitoring, and access-grant management.
        </p>
      </div>

      <AdminDashboard />
    </div>
  );
}
