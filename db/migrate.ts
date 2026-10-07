#!/usr/bin/env node
/**
 * db/migrate.ts — one-command database schema setup and verification
 *
 * Usage:
 *   npx tsx db/migrate.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

function getCleanDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete("sslmode");
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌  DATABASE_URL is not set.");
    process.exit(1);
  }

  const isLocal = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
  const cleanUrl = getCleanDatabaseUrl(dbUrl);

  const client = new Client({
    connectionString: cleanUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    console.log("Connecting to PostgreSQL database...");
    await client.connect();

    const schemaPath = resolve(process.cwd(), "db/schema.sql");
    const schema = readFileSync(schemaPath, "utf8");
    console.log("Applying database schema from db/schema.sql...");
    await client.query(schema);
    console.log("✅  Schema applied successfully!");

    // Seed dev admin (optional)
    const adminWallet = process.env.SEED_ADMIN_WALLET?.toLowerCase();
    if (adminWallet) {
      await client.query(
        `INSERT INTO users (wallet_address, role)
         VALUES ($1, 'admin')
         ON CONFLICT (wallet_address)
         DO UPDATE SET role = 'admin'`,
        [adminWallet]
      );
      console.log(`✅  Admin wallet seeded: ${adminWallet}`);
    }

    console.log("🎉  Migration complete.");
  } catch (err) {
    console.error("❌  Migration error:", (err as Error).message);
    process.exit(1);
  } finally {
    try {
      await client.end();
    } catch {}
  }
}

main();
