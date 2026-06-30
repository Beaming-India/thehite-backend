
// Run with: node --env-file=.env migrate-better-auth.mjs
import pg from "./node_modules/.pnpm/pg@8.21.0/node_modules/pg/lib/index.js";

const { Client } = pg;

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

await client.connect();
console.log("Connected to database");

try {
  await client.query("BEGIN");

  // 1. Add new columns to existing users table
  await client.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS name VARCHAR,
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS image VARCHAR;
  `);
  console.log("✓ users table updated");

  // 2. Create ba_sessions table
  await client.query(`
    CREATE TABLE IF NOT EXISTS ba_sessions (
      id VARCHAR PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL,
      token VARCHAR NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  console.log("✓ ba_sessions table created");

  // 3. Create ba_accounts table
  await client.query(`
    CREATE TABLE IF NOT EXISTS ba_accounts (
      id VARCHAR PRIMARY KEY,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      access_token_expires_at TIMESTAMPTZ,
      refresh_token_expires_at TIMESTAMPTZ,
      scope TEXT,
      password TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);
  console.log("✓ ba_accounts table created");

  // 4. Create ba_verifications table
  await client.query(`
    CREATE TABLE IF NOT EXISTS ba_verifications (
      id VARCHAR PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    );
  `);
  console.log("✓ ba_verifications table created");

  await client.query("COMMIT");
  console.log("\n✅ Migration complete — better-auth schema applied");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await client.end();
}
