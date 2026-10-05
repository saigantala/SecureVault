// app/app/profile/page.tsx — User Profile & Security Settings
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { ProfileSettings } from "@/components/ProfileSettings";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Profile & Identity — SecureVault",
};

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let user: { email: string | null; email_verified: boolean | null; role: string; created_at: string } | null = null;

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.sub);
    if (isUuid && process.env.DATABASE_URL) {
      const userRow = await db.query<{
        email: string | null;
        email_verified: boolean | null;
        role: string;
        created_at: string;
      }>(
        `SELECT email, email_verified, role, created_at FROM users WHERE id = $1`,
        [session.sub]
      );
      user = userRow.rows[0] ?? null;
    }
  } catch (err) {
    console.warn("[profile] Could not query user:", (err as Error).message);
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Identity & Vault Settings</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Cryptographic keys, alert preferences, and session security configuration.
        </p>
      </div>

      <ProfileSettings
        initialEmail={user?.email ?? null}
        initialEmailVerified={Boolean(user?.email_verified)}
        role={user?.role ?? "user"}
        createdAt={user?.created_at ?? new Date().toISOString()}
      />
    </div>
  );
}
