// app/api/health/route.ts
// Diagnostic health check route to verify deployment environment & database connectivity.

import { NextResponse } from "next/server";
import { db, ensureDatabaseSchema } from "@/lib/db";

export async function GET() {
  const hasDbUrl = Boolean(process.env.DATABASE_URL);
  let dbStatus = "not_configured";
  let dbError: string | null = null;
  let tablesExist = false;

  if (hasDbUrl) {
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
    } catch (err) {
      dbStatus = "error";
      dbError = (err as Error).message || String(err);
    }
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    database: {
      configured: hasDbUrl,
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
