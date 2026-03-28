import type { Pool } from "pg";

export type RecordDemoTransferResult = {
  reference: string;
  deduped: boolean;
};

/**
 * Idempotent demo transfer row (same key → same reference). Real payments would use the same pattern.
 */
export async function recordDemoTransfer(
  pool: Pool,
  params: {
    idempotencyKey: string;
    sessionId: string;
    phone: string;
    amountUgx: number;
    reference: string;
  }
): Promise<RecordDemoTransferResult> {
  const ins = await pool.query<{ reference: string }>(
    `INSERT INTO demo_transfers (idempotency_key, session_id, phone, amount_ugx, reference)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING reference`,
    [
      params.idempotencyKey,
      params.sessionId,
      params.phone,
      params.amountUgx,
      params.reference,
    ]
  );
  if (ins.rows[0]?.reference) {
    return { reference: ins.rows[0].reference, deduped: false };
  }
  const sel = await pool.query<{ reference: string }>(
    `SELECT reference FROM demo_transfers WHERE idempotency_key = $1`,
    [params.idempotencyKey]
  );
  const ref = sel.rows[0]?.reference ?? params.reference;
  return { reference: ref, deduped: true };
}
