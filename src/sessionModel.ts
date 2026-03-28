/**
 * Call session persisted in Redis (or memory fallback).
 * OTP is stored hashed; plain code exists only in SMS / spoken prompt.
 */

import { hashOtp } from "./otpCrypto.js";

export type Phase =
  | "await_otp"
  | "main_menu"
  | "send_amount"
  | "send_confirm";

export interface CallSession {
  phone: string;
  phase: Phase;
  /** HMAC-SHA256 hex of OTP; empty when none active. */
  otpHash: string;
  /** Unix ms when OTP expires; 0 if none. */
  otpExpiresAt: number;
  otpAttempts: number;
  otpSmsSent: boolean;
  /** Mock send-money flow: amount in UGX before confirm. */
  pendingSendAmount: number | null;
  /** Increments each time user reaches confirm step (idempotency for demo transfer). */
  transferNonce: number;
}

export function createNewSession(phone: string): CallSession {
  return {
    phone,
    phase: "await_otp",
    otpHash: "",
    otpExpiresAt: 0,
    otpAttempts: 0,
    otpSmsSent: false,
    pendingSendAmount: null,
    transferNonce: 0,
  };
}

export function assignOtpChallenge(
  session: CallSession,
  plainCode: string,
  pepper: string,
  ttlSec: number
): void {
  session.otpHash = hashOtp(plainCode, pepper);
  session.otpExpiresAt = Date.now() + ttlSec * 1000;
  session.otpAttempts = 0;
}

export function clearOtpChallenge(session: CallSession): void {
  session.otpHash = "";
  session.otpExpiresAt = 0;
}

export function otpStillValid(session: CallSession): boolean {
  return Boolean(session.otpHash) && Date.now() < session.otpExpiresAt;
}
