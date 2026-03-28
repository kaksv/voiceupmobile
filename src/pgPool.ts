import pg from "pg";
import { DATABASE_URL, PGSSL_RELAX } from "./config.js";

let pool: pg.Pool | null = null;

function pgPoolConfig(): pg.PoolConfig {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL required for Postgres");
  }
  const u = DATABASE_URL.toLowerCase();
  const isLocal =
    u.includes("localhost") ||
    u.includes("127.0.0.1") ||
    u.includes("socket:");

  let ssl: pg.PoolConfig["ssl"];
  if (!isLocal) {
    ssl = PGSSL_RELAX ? { rejectUnauthorized: false } : undefined;
  }

  return {
    connectionString: DATABASE_URL,
    max: 8,
    idleTimeoutMillis: 30_000,
    ssl,
  };
}

async function ensureSchema(p: pg.Pool): Promise<void> {
  await p.query(`
    CREATE TABLE IF NOT EXISTS voice_sessions (
      session_id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS voice_sessions_expires_at_idx
    ON voice_sessions (expires_at)
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS demo_transfers (
      idempotency_key TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      amount_ugx BIGINT NOT NULL,
      reference TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS demo_transfers_session_idx
    ON demo_transfers (session_id)
  `);
  await p.query(`
    CREATE INDEX IF NOT EXISTS demo_transfers_created_idx
    ON demo_transfers (created_at DESC)
  `);
}

/** Connect singleton pool and run migrations. No-op pool if already connected. */
export async function connectPostgres(): Promise<pg.Pool> {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new pg.Pool(pgPoolConfig());
    pool.on("error", (err: Error) => {
      console.error("[postgres] pool error:", err.message);
    });
    await ensureSchema(pool);
    await pool.query("SELECT 1");
  }
  return pool;
}

export function getPgPool(): pg.Pool | null {
  return pool;
}

export async function closePostgres(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
