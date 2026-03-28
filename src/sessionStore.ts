import type { Pool } from "pg";
import { Redis } from "ioredis";
import { DATABASE_URL, REDIS_URL, SESSION_TTL_SEC } from "./config.js";
import { closePostgres, connectPostgres } from "./pgPool.js";
import type { CallSession } from "./sessionModel.js";

const KEY_PREFIX = "atv:session:";

export type SessionBackend = "postgres" | "redis" | "memory";

export interface SessionStore {
  get(sessionId: string): Promise<CallSession | null>;
  set(sessionId: string, session: CallSession): Promise<void>;
  del(sessionId: string): Promise<void>;
  ping(): Promise<boolean>;
}

class PostgresSessionStore implements SessionStore {
  constructor(private readonly pool: Pool) {}

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
    const raw = row.payload as CallSession;
    return { ...raw, transferNonce: raw.transferNonce ?? 0 };
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
    if (!v) return null;
    return { ...v, transferNonce: v.transferNonce ?? 0 };
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
      const s = JSON.parse(raw) as CallSession;
      return { ...s, transferNonce: s.transferNonce ?? 0 };
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
    const pool = await connectPostgres();
    console.info("[session] using PostgreSQL for call sessions");
    const store = new PostgresSessionStore(pool);
    return {
      store,
      backend: "postgres",
      shutdown: async () => {
        await closePostgres();
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
