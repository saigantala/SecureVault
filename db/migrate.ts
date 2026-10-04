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

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌  DATABASE_URL is not set.");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });

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
