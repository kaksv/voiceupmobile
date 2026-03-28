import type { Pool } from "pg";

/**
 * Aggregated, low-PII snapshot for the admin AI (no full phones or OTP secrets).
 */
export async function buildPilotContext(pool: Pool): Promise<Record<string, unknown>> {
  const [sessionsCount, transfersCount, phases, recent] = await Promise.all([
    pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM voice_sessions`),
    pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM demo_transfers`),
    pool.query<{ phase: string; n: string }>(
      `SELECT COALESCE(payload->>'phase','unknown') AS phase, COUNT(*)::text AS n
       FROM voice_sessions GROUP BY 1`
    ),
    pool.query<{
      reference: string;
      amount_ugx: string;
      session_id: string;
      created_at: Date;
    }>(
      `SELECT reference, amount_ugx::text, session_id, created_at
       FROM demo_transfers
       ORDER BY created_at DESC
       LIMIT 12`
    ),
  ]);

  const sessionsByPhase: Record<string, number> = {};
  for (const row of phases.rows) {
    sessionsByPhase[row.phase] = Number.parseInt(row.n, 10) || 0;
  }

  const recentDemoTransfers = recent.rows.map((r) => ({
    reference: r.reference,
    amountUgx: r.amount_ugx,
    sessionIdPrefix: r.session_id.slice(0, 12),
    createdAt: r.created_at,
  }));

  return {
    generatedAt: new Date().toISOString(),
    voiceSessionsInDb: Number.parseInt(sessionsCount.rows[0]?.c ?? "0", 10) || 0,
    demoTransfersTotal: Number.parseInt(transfersCount.rows[0]?.c ?? "0", 10) || 0,
    sessionsByPhase,
    recentDemoTransfers,
  };
}
