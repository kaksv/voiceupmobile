import { Redis } from "ioredis";
import pg from "pg";
import {
  DATABASE_URL,
  PGSSL_RELAX,
  REDIS_URL,
  SESSION_TTL_SEC,
} from "./config.js";
import type { CallSession } from "./sessionModel.js";

const KEY_PREFIX = "atv:session:";

export type SessionBackend = "postgres" | "redis" | "memory";

export interface SessionStore {
  get(sessionId: string): Promise<CallSession | null>;
  set(sessionId: string, session: CallSession): Promise<void>;
  del(sessionId: string): Promise<void>;
  ping(): Promise<boolean>;
}

function pgPoolConfig(): pg.PoolConfig {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL required for Postgres pool");
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

async function ensureVoiceSessionsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_sessions (
      session_id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS voice_sessions_expires_at_idx
    ON voice_sessions (expires_at)
  `);
}

class PostgresSessionStore implements SessionStore {
  constructor(private readonly pool: pg.Pool) {}

  async get(sessionId: string): Promise<CallSession | null> {
    const r = await this.pool.query<{
      payload: CallSession;
      expires_at: Date;
    }>(
      `SELECT payload, expires_at FROM voice_sessions WHERE session_id = $1`,
      [sessionId]
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    if (!row) return null;
    const exp =
      row.expires_at instanceof Date
        ? row.expires_at.getTime()
        : new Date(row.expires_at).getTime();
    if (exp <= Date.now()) {
      await this.pool.query(`DELETE FROM voice_sessions WHERE session_id = $1`, [
        sessionId,
      ]);
      return null;
    }
    return row.payload as CallSession;
  }

  async set(sessionId: string, session: CallSession): Promise<void> {
    const expiresAt = new Date(Date.now() + SESSION_TTL_SEC * 1000);
    await this.pool.query(
      `INSERT INTO voice_sessions (session_id, payload, expires_at, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (session_id) DO UPDATE SET
         payload = EXCLUDED.payload,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
      [sessionId, JSON.stringify(session), expiresAt]
    );
  }

  async del(sessionId: string): Promise<void> {
    await this.pool.query(`DELETE FROM voice_sessions WHERE session_id = $1`, [
      sessionId,
    ]);
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}

class MemorySessionStore implements SessionStore {
  private readonly map = new Map<string, CallSession>();

  async get(sessionId: string): Promise<CallSession | null> {
    const v = this.map.get(sessionId);
    return v ? { ...v } : null;
  }

  async set(sessionId: string, session: CallSession): Promise<void> {
    this.map.set(sessionId, { ...session });
  }

  async del(sessionId: string): Promise<void> {
    this.map.delete(sessionId);
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

class RedisSessionStore implements SessionStore {
  constructor(private readonly client: Redis) {}

  async get(sessionId: string): Promise<CallSession | null> {
    const raw = await this.client.get(KEY_PREFIX + sessionId);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as CallSession;
    } catch {
      return null;
    }
  }

  async set(sessionId: string, session: CallSession): Promise<void> {
    await this.client.setex(
      KEY_PREFIX + sessionId,
      SESSION_TTL_SEC,
      JSON.stringify(session)
    );
  }

  async del(sessionId: string): Promise<void> {
    await this.client.del(KEY_PREFIX + sessionId);
  }

  async ping(): Promise<boolean> {
    try {
      const p = await this.client.ping();
      return p === "PONG";
    } catch {
      return false;
    }
  }
}

export async function createSessionStore(): Promise<{
  store: SessionStore;
  shutdown: () => Promise<void>;
  backend: SessionBackend;
}> {
  if (DATABASE_URL) {
    const pool = new pg.Pool(pgPoolConfig());
    pool.on("error", (err: Error) => {
      console.error("[postgres] pool error:", err.message);
    });
    await ensureVoiceSessionsTable(pool);
    await pool.query("SELECT 1");
    console.info("[session] using PostgreSQL for call sessions");
    const store = new PostgresSessionStore(pool);
    return {
      store,
      backend: "postgres",
      shutdown: async () => {
        await pool.end();
      },
    };
  }

  if (REDIS_URL) {
    const redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    redis.on("error", (err: Error) => {
      console.error("[redis] connection error:", err.message);
    });
    await redis.ping();
    console.info("[session] using Redis for call sessions");
    const store = new RedisSessionStore(redis);
    return {
      store,
      backend: "redis",
      shutdown: async () => {
        await redis.quit();
      },
    };
  }

  console.warn(
    "[session] DATABASE_URL and REDIS_URL unset — using in-memory sessions (lost on restart; not for multi-instance)"
  );
  return {
    store: new MemorySessionStore(),
    backend: "memory",
    shutdown: async () => {},
  };
}
