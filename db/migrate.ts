#!/usr/bin/env node
/**
 * db/migrate.ts — one-command setup
 *
 * Usage:
 *   npx tsx db/migrate.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌  DATABASE_URL is not set.");
    process.exit(1);
  }

  const isLocal =
    dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");

  const client = new Client({
    connectionString: dbUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const schema = readFileSync(resolve("db/schema.sql"), "utf8");
    await client.query(schema);
    console.log("✅  Schema applied.");

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
    console.error("❌  Migration failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
