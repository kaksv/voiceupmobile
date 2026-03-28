import {
  AT_API_KEY,
  AT_SENDER_ID,
  AT_USERNAME,
  SMS_ENQUEUE,
  SMS_MAX_ATTEMPTS,
} from "./config.js";

function apiRoot(): string {
  return AT_USERNAME === "sandbox"
    ? "https://api.sandbox.africastalking.com"
    : "https://api.africastalking.com";
}

export type AtRecipient = {
  number: string;
  status: string;
  statusCode?: number | string;
};

export type SmsOutcome =
  | { outcome: "no_api_key" }
  | { outcome: "http_error"; status: number; body: string }
  | { outcome: "not_accepted"; recipients: AtRecipient[]; raw: unknown }
  | { outcome: "delivered"; recipients: AtRecipient[]; raw: unknown };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isSuccessStatus(status: string): boolean {
  const t = status.toLowerCase();
  return t === "success" || t === "sent" || t.startsWith("success");
}

function parseRecipients(data: unknown): {
  recipients: AtRecipient[];
  allAccepted: boolean;
} {
  const o = data as {
    SMSMessageData?: {
      Recipients?: Array<{
        number?: string;
        status?: string;
        statusCode?: number | string;
      }>;
    };
  };
  const raw = o.SMSMessageData?.Recipients ?? [];
  const recipients: AtRecipient[] = raw.map((r) => ({
    number: String(r.number ?? ""),
    status: String(r.status ?? ""),
    statusCode: r.statusCode,
  }));
  if (recipients.length === 0) {
    return { recipients, allAccepted: false };
  }
  const allAccepted = recipients.every((r) => isSuccessStatus(r.status));
  return { recipients, allAccepted };
}

async function postMessaging(
  toE164: string,
  message: string
): Promise<{ httpOk: boolean; status: number; bodyText: string; json: unknown | null }> {
  const url = `${apiRoot()}/version1/messaging`;
  const body = new URLSearchParams({
    username: AT_USERNAME,
    to: toE164,
    message,
    bulkSMSMode: "1",
  });
  if (AT_SENDER_ID) body.set("from", AT_SENDER_ID);
  if (SMS_ENQUEUE) body.set("enqueue", "1");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      apiKey: AT_API_KEY,
    },
    body,
  });

  const bodyText = await res.text();
  let json: unknown | null = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      json = JSON.parse(bodyText) as unknown;
    } catch {
      json = null;
    }
  }

  return { httpOk: res.ok, status: res.status, bodyText, json };
}

/**
 * Send SMS with retries and parse Africa's Talking JSON so we know if the SMS layer accepted delivery.
 */
export async function sendOtpSms(
  toE164: string,
  message: string
): Promise<SmsOutcome> {
  if (!AT_API_KEY) {
    console.warn(
      "[sms] AT_API_KEY missing; skipping SMS POST. Message would be: %s",
      message
    );
    return { outcome: "no_api_key" };
  }

  let lastFailure: SmsOutcome | undefined;

  for (let attempt = 1; attempt <= SMS_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      console.info(`[sms] retry attempt ${attempt}/${SMS_MAX_ATTEMPTS}`);
      await sleep(800);
    }

    let post: Awaited<ReturnType<typeof postMessaging>>;
    try {
      post = await postMessaging(toE164, message);
    } catch (e) {
      console.error("[sms] network error:", e);
      lastFailure = { outcome: "http_error", status: 0, body: String(e) };
      continue;
    }

    if (!post.httpOk) {
      console.error(
        `[sms] HTTP ${post.status}: ${post.bodyText.slice(0, 500)}`
      );
      lastFailure = {
        outcome: "http_error",
        status: post.status,
        body: post.bodyText,
      };
      continue;
    }

    if (post.json == null) {
      console.warn(
        "[sms] 2xx but missing JSON; body:",
        post.bodyText.slice(0, 300)
      );
      lastFailure = {
        outcome: "http_error",
        status: post.status,
        body: post.bodyText,
      };
      continue;
    }

    const { recipients, allAccepted } = parseRecipients(post.json);
    console.info("[sms] recipients:", JSON.stringify(recipients));

    if (allAccepted) {
      return { outcome: "delivered", recipients, raw: post.json };
    }

    lastFailure = {
      outcome: "not_accepted",
      recipients,
      raw: post.json,
    };
  }

  return lastFailure ?? {
    outcome: "http_error",
    status: 0,
    body: "no attempts",
  };
}
