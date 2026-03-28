import express from "express";
import {
  AT_API_KEY,
  DATABASE_URL,
  OTP_ALSO_SPEAK_ON_CALL,
  PORT,
  PUBLIC_BASE_URL,
  REDIS_URL,
  SMS_MAX_ATTEMPTS,
} from "./config.js";
import { createSessionStore } from "./sessionStore.js";
import {
  setSessionStore,
  storePing,
} from "./sessionsRuntime.js";
import { handleVoiceInbound } from "./voiceWebhook.js";

async function main(): Promise<void> {
  const { store, shutdown, backend } = await createSessionStore();
  setSessionStore(store);

  const app = express();

  app.use(express.urlencoded({ extended: false }));

  app.get("/health", async (_req, res) => {
    let sessionStoreOk = false;
    try {
      sessionStoreOk = await storePing();
    } catch {
      sessionStoreOk = false;
    }
    res.json({
      status: "ok",
      sms_configured: Boolean(AT_API_KEY),
      public_base_url_configured: Boolean(PUBLIC_BASE_URL),
      session_backend: backend,
      database_configured: Boolean(DATABASE_URL),
      redis_configured: Boolean(REDIS_URL),
      session_store_ok: sessionStoreOk,
      otp_also_speak_on_call: OTP_ALSO_SPEAK_ON_CALL,
      sms_max_attempts: SMS_MAX_ATTEMPTS,
    });
  });

  app.post("/webhooks/voice/inbound", (req, res, next) => {
    handleVoiceInbound(req, res).catch(next);
  });

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error(err);
      res.status(500).type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Service error. Please try again later.</Say>
</Response>`);
    }
  );

  const server = app.listen(PORT, () => {
    console.info(`MoMo Voice MVP listening on http://0.0.0.0:${PORT}`);
  });

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((e) => (e ? reject(e) : resolve()));
    });
    await shutdown();
  };

  process.on("SIGINT", () => {
    void close().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void close().then(() => process.exit(0));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
