// lib/db.ts
// PostgreSQL connection pool — server-side only.
// Uses the `pg` driver directly (no ORM) to stay as close to the
// architecture doc schema as possible and keep the dependency surface small.
//
// If you later want migrations/type-safety, Drizzle ORM wraps `pg` pools
// and is a direct drop-in — see migrations/ for SQL-first workflow.

import { Pool } from "pg";

declare global {
  // Prevent creating multiple pools in Next.js dev hot-reload
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: true }
        : false,
  });
}

// In development, reuse the pool across hot reloads.
// In production, create exactly one pool instance.
export const db: Pool =
  process.env.NODE_ENV === "production"
    ? createPool()
    : (global._pgPool ??= createPool());

// Helper: run a query and return typed rows
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[]
) {
  return db.query<T>(text, values);
}
