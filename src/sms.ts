import { AT_API_KEY, AT_SENDER_ID, AT_USERNAME } from "./config.js";

function apiRoot(): string {
  return AT_USERNAME === "sandbox"
    ? "https://api.sandbox.africastalking.com"
    : "https://api.africastalking.com";
}

/**
 * POST to /version1/messaging (same shape as official Africa's Talking SDK).
 */
export async function sendSms(toE164: string, message: string): Promise<unknown> {
  if (!AT_API_KEY) {
    console.warn(
      `[sms] AT_API_KEY missing; SMS not sent (dev mode). Message would be: ${message}`
    );
    return { note: "missing_api_key", dev_payload: message };
  }

  const url = `${apiRoot()}/version1/messaging`;
  const body = new URLSearchParams({
    username: AT_USERNAME,
    to: toE164,
    message,
    bulkSMSMode: "1",
  });
  if (AT_SENDER_ID) body.set("from", AT_SENDER_ID);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      apiKey: AT_API_KEY,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[sms] AT error ${res.status}: ${text}`);
    throw new Error(`SMS failed: ${res.status}`);
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return res.json();
  }
  return res.text();
}
