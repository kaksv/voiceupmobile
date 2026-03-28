import {
  Router,
  json,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { buildPilotContext } from "./adminContext.js";
import {
  ADMIN_TOKEN,
  OPENAI_API_KEY,
  OPENAI_MODEL,
} from "./config.js";
import { getPgPool } from "./pgPool.js";
import { openAiChat } from "./openAiInsights.js";
import type { CallSession } from "./sessionModel.js";
import { maskPhoneE164 } from "./voiceLog.js";

function adminAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: "admin_disabled" });
    return;
  }
  const auth = req.headers.authorization;
  const bearer =
    auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : undefined;
  const q = typeof req.query.token === "string" ? req.query.token : undefined;
  const tok = bearer ?? q;
  if (tok !== ADMIN_TOKEN) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

function publicSessionPayload(p: CallSession): Record<string, unknown> {
  return {
    phone: maskPhoneE164(p.phone),
    phase: p.phase,
    otpActive: Boolean(p.otpHash),
    otpExpiresAt: p.otpExpiresAt || null,
    otpAttempts: p.otpAttempts,
    otpSmsSent: p.otpSmsSent,
    pendingSendAmount: p.pendingSendAmount,
    transferNonce: p.transferNonce ?? 0,
  };
}

const adminPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MoMo Voice — Admin</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; max-width: 960px; }
    h1 { font-size: 1.25rem; }
    table { border-collapse: collapse; width: 100%; font-size: 0.875rem; }
    th, td { border: 1px solid #ccc; padding: 0.4rem 0.5rem; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; }
    code { font-size: 0.8rem; }
    .muted { color: #666; font-size: 0.8rem; }
    #tokenRow { margin-bottom: 1rem; }
    input[type="password"] { width: 16rem; padding: 0.35rem; }
    button { padding: 0.35rem 0.75rem; }
  </style>
</head>
<body>
  <h1>MoMo Voice assistant — pilot admin</h1>
  <p class="muted">Sessions and demo transfers (Postgres only). For AI insights use the <a href="/">dashboard</a>. Token: <code>Authorization: Bearer …</code></p>
  <div id="tokenRow">
    <label>Admin token <input type="password" id="token" autocomplete="off" /></label>
    <button type="button" id="load">Load</button>
  </div>
  <h2>Sessions</h2>
  <div id="sessions">Enter token and load.</div>
  <h2>Demo transfers</h2>
  <div id="transfers"></div>
  <script>
    const tokenEl = document.getElementById('token');
    const hdr = () => ({ 'Authorization': 'Bearer ' + tokenEl.value.trim(), 'Accept': 'application/json' });
    document.getElementById('load').onclick = async () => {
      const t = tokenEl.value.trim();
      if (!t) { alert('Token required'); return; }
      try {
        const [sRes, tRes] = await Promise.all([
          fetch('/api/admin/sessions?limit=40', { headers: hdr() }),
          fetch('/api/admin/transfers?limit=40', { headers: hdr() }),
        ]);
        if (!sRes.ok) { document.getElementById('sessions').textContent = await sRes.text(); return; }
        if (!tRes.ok) { document.getElementById('transfers').textContent = await tRes.text(); return; }
        const sJson = await sRes.json();
        const tJson = await tRes.json();
        document.getElementById('sessions').innerHTML = renderSessions(sJson.sessions || []);
        document.getElementById('transfers').innerHTML = renderTransfers(tJson.transfers || []);
      } catch (e) {
        document.getElementById('sessions').textContent = String(e);
      }
    };
    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
    function renderSessions(rows) {
      if (!rows.length) return '<p class="muted">No rows.</p>';
      let h = '<table><thead><tr><th>session_id</th><th>updated</th><th>expires</th><th>payload</th></tr></thead><tbody>';
      for (const r of rows) {
        h += '<tr><td><code>' + esc(r.session_id) + '</code></td><td>' + esc(r.updated_at) + '</td><td>' + esc(r.expires_at) + '</td><td><pre>' + esc(JSON.stringify(r.payload, null, 2)) + '</pre></td></tr>';
      }
      h += '</tbody></table>';
      return h;
    }
    function renderTransfers(rows) {
      if (!rows.length) return '<p class="muted">No rows.</p>';
      let h = '<table><thead><tr><th>time</th><th>reference</th><th>session</th><th>phone</th><th>amount UGX</th><th>idempotency</th></tr></thead><tbody>';
      for (const r of rows) {
        h += '<tr><td>' + esc(r.created_at) + '</td><td><code>' + esc(r.reference) + '</code></td><td><code>' + esc(r.session_id) + '</code></td><td>' + esc(r.phone) + '</td><td>' + esc(r.amount_ugx) + '</td><td><code>' + esc(r.idempotency_key) + '</code></td></tr>';
      }
      h += '</tbody></table>';
      return h;
    }
  </script>
</body>
</html>`;

export function registerAdminRoutes(app: Express): void {
  if (!ADMIN_TOKEN) {
    console.info("[admin] ADMIN_TOKEN not set — admin UI and /api/admin/* disabled");
    return;
  }

  app.get("/admin", (_req, res) => {
    res.type("html").send(adminPageHtml);
  });

  const api = Router();
  api.use(adminAuthMiddleware);
  api.use(json({ limit: "128kb" }));

  api.get("/sessions", async (req, res) => {
    const pool = getPgPool();
    if (!pool) {
      res.status(503).json({ error: "postgres_required" });
      return;
    }
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.limit ?? "40"), 10) || 40)
    );
    const r = await pool.query<{
      session_id: string;
      updated_at: Date;
      expires_at: Date;
      payload: CallSession;
    }>(
      `SELECT session_id, updated_at, expires_at, payload
       FROM voice_sessions
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit]
    );
    const sessions = r.rows.map((row) => ({
      session_id: row.session_id,
      updated_at: row.updated_at,
      expires_at: row.expires_at,
      payload: publicSessionPayload(row.payload),
    }));
    res.json({ sessions });
  });

  api.get("/transfers", async (req, res) => {
    const pool = getPgPool();
    if (!pool) {
      res.status(503).json({ error: "postgres_required" });
      return;
    }
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.limit ?? "40"), 10) || 40)
    );
    const r = await pool.query<{
      idempotency_key: string;
      session_id: string;
      phone: string;
      amount_ugx: string;
      reference: string;
      created_at: Date;
    }>(
      `SELECT idempotency_key, session_id, phone, amount_ugx, reference, created_at
       FROM demo_transfers
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    const transfers = r.rows.map((row) => ({
      idempotency_key: row.idempotency_key,
      session_id: row.session_id,
      phone: maskPhoneE164(row.phone),
      amount_ugx: row.amount_ugx,
      reference: row.reference,
      created_at: row.created_at,
    }));
    res.json({ transfers });
  });

  api.post("/ai/insights", async (req, res) => {
    if (!OPENAI_API_KEY) {
      res.status(503).json({ error: "openai_not_configured" });
      return;
    }
    const pool = getPgPool();
    if (!pool) {
      res.status(503).json({ error: "postgres_required" });
      return;
    }
    const body = req.body as { message?: string };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 4000) {
      res.status(400).json({ error: "invalid_message" });
      return;
    }

    try {
      const context = await buildPilotContext(pool);
      const system = `You are an operations assistant for a Uganda-focused voice mobile-money pilot built on Africa's Talking (IVR + SMS OTP). 
Rules:
- Answer using ONLY the pilot context JSON and the user's question. If data is missing, say you do not have it.
- Do not invent statistics, phone numbers, or user identities.
- Be concise: short headings or bullets. Plain language suitable for a product operator.`;

      const user = `Operator question:\n${message}\n\nPilot context (JSON):\n${JSON.stringify(context, null, 2)}`;

      const answer = await openAiChat({
        apiKey: OPENAI_API_KEY,
        model: OPENAI_MODEL,
        system,
        user,
      });
      res.json({ answer, model: OPENAI_MODEL, contextGeneratedAt: context.generatedAt });
    } catch (e) {
      console.error("[ai/insights]", e);
      res.status(502).json({
        error: "openai_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.use("/api/admin", api);
}
