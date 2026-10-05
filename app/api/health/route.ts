// app/api/health/route.ts
// Diagnostic health check route to verify deployment environment & database connectivity.

import { NextResponse } from "next/server";
import { db, ensureDatabaseSchema } from "@/lib/db";

export async function GET() {
  const rawDbUrl = process.env.DATABASE_URL;
  const hasDbUrl = Boolean(rawDbUrl);
  let dbStatus = "not_configured";
  let dbError: string | null = null;
  let tablesExist = false;
  let dbHost = "none";

  if (rawDbUrl) {
    try {
      const parsed = new URL(rawDbUrl);
      dbHost = parsed.host;
    } catch {
      dbHost = "invalid_url";
    }

    try {
      await ensureDatabaseSchema();
      const test = await db.query("SELECT 1 as connected");
      if (test.rows.length > 0) {
        dbStatus = "connected";
      }
      const tableCheck = await db.query<{ tbl: string | null }>(
        "SELECT to_regclass('public.auth_nonces') as tbl"
      );
      tablesExist = Boolean(tableCheck.rows[0]?.tbl);
    } catch (err: unknown) {
      dbStatus = "error";
      if (err && typeof err === "object" && "errors" in err && Array.isArray((err as { errors: unknown[] }).errors)) {
        dbError = (err as { errors: Error[] }).errors.map((e) => e.message || String(e)).join("; ");
      } else {
        dbError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    database: {
      configured: hasDbUrl,
      host: dbHost,
      status: dbStatus,
      tablesExist,
      error: dbError,
    },
    environment: {
      nodeEnv: process.env.NODE_ENV,
      hasJwtSecret: Boolean(process.env.JWT_SECRET),
      hasWalletConnect: Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_ID),
      hasSmtpHost: Boolean(process.env.SMTP_HOST),
      hasSmtpUser: Boolean(process.env.SMTP_USER),
      hasSmtpPass: Boolean(process.env.SMTP_PASS),
    },
  });
}
