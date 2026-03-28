/**
 * In-memory call session state (MVP).
 * Production: Redis or DB with TTL on OTP rows.
 */

export type Phase = "await_otp" | "main_menu";

export interface CallSession {
  phone: string;
  phase: Phase;
  otpCode: string;
  otpAttempts: number;
  otpSmsSent: boolean;
}

const sessions = new Map<string, CallSession>();

export function getOrCreateSession(sessionId: string, phone: string): CallSession {
  let s = sessions.get(sessionId);
  if (!s) {
    s = {
      phone,
      phase: "await_otp",
      otpCode: "",
      otpAttempts: 0,
      otpSmsSent: false,
    };
    sessions.set(sessionId, s);
  }
  return s;
}

export function generateOtp(session: CallSession, digitCount = 6): string {
  let code = "";
  for (let i = 0; i < digitCount; i++) {
    code += String(Math.floor(Math.random() * 10));
  }
  session.otpCode = code;
  session.otpAttempts = 0;
  return code;
}

export function touchFailedOtp(session: CallSession): void {
  session.otpAttempts += 1;
}

export function dropSession(sessionId: string): void {
  sessions.delete(sessionId);
}
