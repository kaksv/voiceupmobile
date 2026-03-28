import "dotenv/config";

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v;
}

export const AT_USERNAME = env("AT_USERNAME", "sandbox") ?? "sandbox";
export const AT_API_KEY = env("AT_API_KEY") ?? "";
export const PUBLIC_BASE_URL = (env("PUBLIC_BASE_URL") ?? "").replace(/\/$/, "");
export const AT_SENDER_ID = env("AT_SENDER_ID");

/** Demo wallet — replace with real provider / AT Payments later. */
export const MOCK_BALANCE_UGX = 185_400;

export const PORT = Number.parseInt(env("PORT") ?? "3000", 10) || 3000;
