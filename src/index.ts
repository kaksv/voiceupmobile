import express from "express";
import { AT_API_KEY, PORT, PUBLIC_BASE_URL } from "./config.js";
import { handleVoiceInbound } from "./voiceWebhook.js";

const app = express();

app.use(express.urlencoded({ extended: false }));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    sms_configured: Boolean(AT_API_KEY),
    public_base_url_configured: Boolean(PUBLIC_BASE_URL),
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

app.listen(PORT, () => {
  console.info(`MoMo Voice MVP listening on http://0.0.0.0:${PORT}`);
});
