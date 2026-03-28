import type { Request, Response } from "express";
import {
  MOCK_BALANCE_UGX,
  OTP_ALSO_SPEAK_ON_CALL,
  OTP_SPEAK_IF_NO_API_KEY,
  OTP_SPEAK_IF_SMS_FAILS,
  PUBLIC_BASE_URL,
} from "./config.js";
import { sendOtpSms, type SmsOutcome } from "./sms.js";
import {
  generateOtp,
  getOrCreateSession,
  touchFailedOtp,
  type CallSession,
} from "./state.js";
import * as voiceXml from "./voiceXml.js";

const MAX_OTP_ATTEMPTS = 3;

function formRecord(req: Request): Record<string, string> {
  const b = req.body as Record<string, string | string[]>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(b ?? {})) {
    out[k] = Array.isArray(v) ? String(v[0]) : String(v);
  }
  return out;
}

function normalizePhone(form: Record<string, string>): string | undefined {
  const raw =
    form.callerNumber ?? form.phoneNumber ?? form.callerId ?? "";
  const s = String(raw).trim().replace(/\s/g, "");
  if (!s) return undefined;
  if (s.startsWith("+")) return s;
  const digits = s.replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("0") && digits.length >= 9) {
    return `+256${digits.slice(1)}`;
  }
  if (digits.startsWith("256")) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

function sessionIdFrom(form: Record<string, string>): string | undefined {
  const sid = (form.sessionId ?? form.callSessionId ?? "").trim();
  return sid || undefined;
}

function dtmfFrom(form: Record<string, string>): string | undefined {
  const d = (form.dtmfDigits ?? form.digits ?? "").trim();
  return d || undefined;
}

function voiceInboundUrl(): string {
  const base = PUBLIC_BASE_URL.replace(/\/$/, "");
  if (!base) throw new Error("PUBLIC_BASE_URL is not set");
  return `${base}/webhooks/voice/inbound`;
}

function xml(res: Response, body: string): void {
  res.type("application/xml").send(body);
}

function shouldReadOtpAloud(outcome: SmsOutcome): boolean {
  switch (outcome.outcome) {
    case "no_api_key":
      return OTP_SPEAK_IF_NO_API_KEY;
    case "delivered":
      return OTP_ALSO_SPEAK_ON_CALL;
    case "http_error":
    case "not_accepted":
      return OTP_SPEAK_IF_SMS_FAILS;
  }
}

function otpPromptMode(
  outcome: SmsOutcome,
  readAloud: boolean
): "sms_only" | "sms_and_voice" | "voice_only" {
  if (!readAloud) return "sms_only";
  if (outcome.outcome === "delivered") return "sms_and_voice";
  return "voice_only";
}

export async function handleVoiceInbound(req: Request, res: Response): Promise<void> {
  const form = formRecord(req);
  console.info("[voice] form keys:", Object.keys(form).sort().join(", "));

  if (!PUBLIC_BASE_URL) {
    xml(
      res,
      voiceXml.hangupGoodbye(
        "Pilot mis-configured: add PUBLIC_BASE_URL so this server can receive digit callbacks."
      )
    );
    return;
  }

  const sid = sessionIdFrom(form);
  const phone = normalizePhone(form);

  if (!sid || !phone) {
    console.warn("[voice] Missing sessionId or caller number");
    xml(res, voiceXml.rejectBusy());
    return;
  }

  const cb = voiceInboundUrl();
  const session = getOrCreateSession(sid, phone);
  const dtmf = dtmfFrom(form);

  if (session.phase === "await_otp") {
    await handleAwaitOtp(res, session, phone, dtmf, cb);
    return;
  }

  if (session.phase === "main_menu") {
    handleMainMenu(res, dtmf, cb);
    return;
  }

  xml(
    res,
    voiceXml.hangupGoodbye("Something went wrong. Please call again later.")
  );
}

async function handleAwaitOtp(
  res: Response,
  session: CallSession,
  phone: string,
  dtmf: string | undefined,
  cb: string
): Promise<void> {
  if (dtmf === undefined) {
    if (!session.otpSmsSent) {
      const code = generateOtp(session);
      const msg = `MoMo Voice Assistant code: ${code}. Do not share this code.`;
      const outcome = await sendOtpSms(phone, msg);

      const readAloud = shouldReadOtpAloud(outcome);
      if (!readAloud) {
        if (outcome.outcome === "no_api_key") {
          session.otpSmsSent = true;
          xml(
            res,
            voiceXml.hangupGoodbye(
              "SMS is not configured on this server. Please contact support."
            )
          );
          return;
        }
        if (outcome.outcome === "http_error" || outcome.outcome === "not_accepted") {
          console.error("[voice] SMS not delivered;", outcome);
          session.otpSmsSent = true;
          xml(
            res,
            voiceXml.hangupGoodbye(
              "We could not send the verification SMS. Please try your call again later."
            )
          );
          return;
        }
      }

      if (outcome.outcome === "no_api_key") {
        console.warn(`[voice] DEV: OTP for ${phone} (no SMS key): ${code}`);
      }

      session.otpSmsSent = true;
      xml(
        res,
        voiceXml.promptOtp(
          cb,
          readAloud ? code : undefined,
          otpPromptMode(outcome, readAloud)
        )
      );
      return;
    }
    xml(res, voiceXml.promptOtp(cb));
    return;
  }

  if (dtmf === session.otpCode) {
    session.phase = "main_menu";
    xml(res, voiceXml.promptMainMenu(cb));
    return;
  }

  touchFailedOtp(session);
  if (session.otpAttempts >= MAX_OTP_ATTEMPTS) {
    xml(res, voiceXml.rejectBusy());
    return;
  }
  xml(res, voiceXml.promptOtpRetry(cb));
}

function handleMainMenu(
  res: Response,
  dtmf: string | undefined,
  cb: string
): void {
  if (dtmf === undefined) {
    xml(res, voiceXml.promptMainMenu(cb));
    return;
  }
  xml(res, voiceXml.mainMenuAction(dtmf, MOCK_BALANCE_UGX, cb));
}
