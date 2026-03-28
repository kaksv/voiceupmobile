import "dotenv/config";

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v;
}

function envBool(name: string, defaultVal: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultVal;
  const t = v.toLowerCase();
  return t === "1" || t === "true" || t === "yes";
}

export const AT_USERNAME = env("AT_USERNAME", "sandbox") ?? "sandbox";
export const AT_API_KEY = env("AT_API_KEY") ?? "";
export const PUBLIC_BASE_URL = (env("PUBLIC_BASE_URL") ?? "").replace(/\/$/, "");
export const AT_SENDER_ID = env("AT_SENDER_ID");

/** Demo wallet — replace with real provider / AT Payments later. */
export const MOCK_BALANCE_UGX = 185_400;

export const PORT = Number.parseInt(env("PORT") ?? "3000", 10) || 3000;

/**
 * Queue SMS on Africa's Talking (enqueue=1). Can help with rate or brief outages.
 */
export const SMS_ENQUEUE = envBool("SMS_ENQUEUE", false);

/** POST attempts to /messaging per OTP send (1 = no retry). Default 2. */
export const SMS_MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(env("SMS_MAX_ATTEMPTS") ?? "2", 10) || 2
);

/**
 * Pilot: speak the six digits on the call **in addition** to SMS.
 * Use when the API reports Success but the handset never receives SMS (routing/DND).
 * Less secure — turn off in production or replace with resend flow.
 */
export const OTP_ALSO_SPEAK_ON_CALL = envBool("OTP_ALSO_SPEAK_ON_CALL", false);

/**
 * If AT returns an error or a non-Success recipient status, read the code on the call
 * so the user can still verify (secure channel is the phone call itself).
 */
export const OTP_SPEAK_IF_SMS_FAILS = envBool("OTP_SPEAK_IF_SMS_FAILS", true);

/** When AT_API_KEY is missing, still read OTP on the call (local dev). */
export const OTP_SPEAK_IF_NO_API_KEY = envBool("OTP_SPEAK_IF_NO_API_KEY", true);

/**
 * Postgres connection URL (Render sets this when you attach a PostgreSQL instance).
 * Preferred session store when set.
 */
export const DATABASE_URL = env("DATABASE_URL");

/** Redis URL for call sessions if DATABASE_URL is unset (e.g. redis://localhost:6379). */
export const REDIS_URL = env("REDIS_URL");

/**
 * For hosted Postgres (e.g. Render), TLS is required; many providers use certs Node does not trust by default.
 * When true (default), `rejectUnauthorized: false` is passed to `pg` (only affects SSL connections).
 */
export const PGSSL_RELAX = envBool("PGSSL_RELAX", true);

/**
 * Server secret for OTP hashing (HMAC-SHA256). Required for production; dev default is insecure.
 */
export const OTP_PEPPER =
  env("OTP_PEPPER") ?? "dev-insecure-otp-pepper-change-in-production";

if (!env("OTP_PEPPER") && env("NODE_ENV") === "production") {
  console.warn(
    "[config] OTP_PEPPER is not set — set a strong secret in production."
  );
}

/** OTP validity window in seconds. */
export const OTP_TTL_SEC = Math.max(
  60,
  Number.parseInt(env("OTP_TTL_SEC") ?? "600", 10) || 600
);

/** Session row/key TTL (refreshed on each save). Postgres `expires_at` and Redis EX. Default 24h. */
export const SESSION_TTL_SEC = Math.max(
  300,
  Number.parseInt(env("SESSION_TTL_SEC") ?? "86400", 10) || 86400
);

/** Mock send-money limits (UGX whole shillings). */
export const MIN_SEND_UGX = Math.max(
  1,
  Number.parseInt(env("MIN_SEND_UGX") ?? "500", 10) || 500
);
export const MAX_SEND_UGX = Math.max(
  MIN_SEND_UGX,
  Number.parseInt(env("MAX_SEND_UGX") ?? "50000000", 10) || 50_000_000
);

/**
 * Bearer token for `/admin` and `/api/admin/*`. If unset, admin routes are not registered.
 */
export const ADMIN_TOKEN = env("ADMIN_TOKEN");
