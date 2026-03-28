import type { Request, Response } from "express";
import {
  MAX_SEND_UGX,
  MIN_SEND_UGX,
  MOCK_BALANCE_UGX,
  OTP_ALSO_SPEAK_ON_CALL,
  OTP_PEPPER,
  OTP_SPEAK_IF_NO_API_KEY,
  OTP_SPEAK_IF_SMS_FAILS,
  OTP_TTL_SEC,
  PUBLIC_BASE_URL,
} from "./config.js";
import {
  logMockTransfer,
  mockTransferReference,
} from "./mockTransfer.js";
import { randomOtpDigits, verifyOtpAgainstHash } from "./otpCrypto.js";
import {
  assignOtpChallenge,
  clearOtpChallenge,
  otpStillValid,
  type CallSession,
} from "./sessionModel.js";
import {
  loadOrCreateSession,
  saveSession,
} from "./sessionsRuntime.js";
import { sendOtpSms, type SmsOutcome } from "./sms.js";
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

function parseAmountUgx(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  if (!Number.isFinite(n) || n < MIN_SEND_UGX || n > MAX_SEND_UGX) {
    return null;
  }
  return n;
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
  let session = await loadOrCreateSession(sid, phone);
  const dtmf = dtmfFrom(form);

  if (session.phase === "await_otp") {
    await handleAwaitOtp(res, sid, session, phone, dtmf, cb);
    return;
  }

  if (session.phase === "main_menu") {
    await handleMainMenu(res, sid, session, dtmf, cb);
    return;
  }

  if (session.phase === "send_amount") {
    await handleSendAmount(res, sid, session, dtmf, cb);
    return;
  }

  if (session.phase === "send_confirm") {
    await handleSendConfirm(res, sid, session, dtmf, cb);
    return;
  }

  xml(
    res,
    voiceXml.hangupGoodbye("Something went wrong. Please call again later.")
  );
}

async function handleAwaitOtp(
  res: Response,
  sid: string,
  session: CallSession,
  phone: string,
  dtmf: string | undefined,
  cb: string
): Promise<void> {
  if (dtmf === undefined) {
    if (!session.otpSmsSent) {
      const code = randomOtpDigits(6);
      assignOtpChallenge(session, code, OTP_PEPPER, OTP_TTL_SEC);
      const msg = `MoMo Voice Assistant code: ${code}. Do not share this code.`;
      const outcome = await sendOtpSms(phone, msg);

      const readAloud = shouldReadOtpAloud(outcome);
      if (!readAloud) {
        if (outcome.outcome === "no_api_key") {
          session.otpSmsSent = true;
          await saveSession(sid, session);
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
          await saveSession(sid, session);
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
      await saveSession(sid, session);
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

  if (session.otpHash && !otpStillValid(session)) {
    clearOtpChallenge(session);
    session.otpSmsSent = false;
    await saveSession(sid, session);
    xml(
      res,
      voiceXml.hangupGoodbye(
        "Your verification code has expired. Please hang up and call again."
      )
    );
    return;
  }

  if (
    session.otpHash &&
    verifyOtpAgainstHash(dtmf, session.otpHash, OTP_PEPPER)
  ) {
    clearOtpChallenge(session);
    session.phase = "main_menu";
    await saveSession(sid, session);
    xml(res, voiceXml.promptMainMenu(cb));
    return;
  }

  session.otpAttempts += 1;
  await saveSession(sid, session);
  if (session.otpAttempts >= MAX_OTP_ATTEMPTS) {
    xml(res, voiceXml.rejectBusy());
    return;
  }
  xml(res, voiceXml.promptOtpRetry(cb));
}

async function handleMainMenu(
  res: Response,
  sid: string,
  session: CallSession,
  dtmf: string | undefined,
  cb: string
): Promise<void> {
  if (dtmf === undefined) {
    xml(res, voiceXml.promptMainMenu(cb));
    return;
  }
  if (dtmf === "3") {
    session.phase = "send_amount";
    session.pendingSendAmount = null;
    await saveSession(sid, session);
    xml(res, voiceXml.promptSendAmount(cb));
    return;
  }
  xml(res, voiceXml.mainMenuAction(dtmf, MOCK_BALANCE_UGX, cb));
}

async function handleSendAmount(
  res: Response,
  sid: string,
  session: CallSession,
  dtmf: string | undefined,
  cb: string
): Promise<void> {
  if (dtmf === undefined) {
    xml(res, voiceXml.promptSendAmount(cb));
    return;
  }
  const amount = parseAmountUgx(dtmf);
  if (amount == null) {
    xml(res, voiceXml.promptSendAmountRetry(cb));
    return;
  }
  session.pendingSendAmount = amount;
  session.phase = "send_confirm";
  await saveSession(sid, session);
  xml(res, voiceXml.promptSendConfirm(cb, amount));
}

async function handleSendConfirm(
  res: Response,
  sid: string,
  session: CallSession,
  dtmf: string | undefined,
  cb: string
): Promise<void> {
  const pending = session.pendingSendAmount;
  if (pending == null) {
    session.phase = "main_menu";
    await saveSession(sid, session);
    xml(res, voiceXml.promptMainMenu(cb));
    return;
  }

  if (dtmf === undefined) {
    xml(res, voiceXml.promptSendConfirm(cb, pending));
    return;
  }

  if (dtmf === "1") {
    const ref = mockTransferReference();
    logMockTransfer({
      phone: session.phone,
      amountUgx: pending,
      reference: ref,
    });
    session.phase = "main_menu";
    session.pendingSendAmount = null;
    await saveSession(sid, session);
    const formatted = pending.toLocaleString("en-US");
    xml(
      res,
      voiceXml.hangupGoodbye(
        `Demo send complete. Reference ${ref}. Amount ${formatted} Ugandan shillings was not really sent. Goodbye.`
      )
    );
    return;
  }

  if (dtmf === "2") {
    session.phase = "main_menu";
    session.pendingSendAmount = null;
    await saveSession(sid, session);
    xml(res, voiceXml.promptMainMenu(cb));
    return;
  }

  xml(res, voiceXml.promptSendConfirm(cb, pending));
}
