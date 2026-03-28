/**
 * Africa's Talking Voice XML (Say, GetDigits, Reject).
 * If digit collection never hits your server, try `callBackUrl` instead of `callbackUrl`.
 */

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function response(...children: string[]): string {
  const inner = children.join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n    ${inner}\n</Response>`;
}

function say(text: string, voice?: string): string {
  const textE = escapeXml(text);
  if (voice) {
    return `<Say voice="${escapeXml(voice)}">${textE}</Say>`;
  }
  return `<Say>${textE}</Say>`;
}

export function rejectBusy(): string {
  return response('<Reject reason="busy"/>');
}

export function hangupGoodbye(message: string): string {
  return response(say(message));
}

export function promptOtp(callbackUrl: string): string {
  const url = escapeXml(callbackUrl);
  return response(
    `<GetDigits timeout="45" numDigits="6" callbackUrl="${url}">
        ${say(
          "Welcome to the MoMo voice assistant demo. We are sending a six digit code to your phone by SMS. Enter the code using your keypad when you hear the beep."
        )}
    </GetDigits>`
  );
}

export function promptOtpRetry(callbackUrl: string): string {
  const url = escapeXml(callbackUrl);
  return response(
    `<GetDigits timeout="45" numDigits="6" callbackUrl="${url}">
        ${say("That code was not correct. Please enter the six digit code again.")}
    </GetDigits>`
  );
}

export function promptMainMenu(callbackUrl: string): string {
  const url = escapeXml(callbackUrl);
  return response(
    `<GetDigits timeout="20" numDigits="1" callbackUrl="${url}">
        ${say(
          "You are verified. For a demo balance in Ugandan shillings, press 1. For a savings tip, press 2. To end the call, press 0."
        )}
    </GetDigits>`
  );
}

export function mainMenuAction(
  digit: string,
  mockBalanceUgx: number,
  menuCallbackUrl: string
): string {
  if (digit === "1") {
    const formatted = mockBalanceUgx.toLocaleString("en-US");
    return hangupGoodbye(
      `Your demo wallet balance is ${formatted} Ugandan shillings. This is mock data for the pilot. Goodbye.`
    );
  }
  if (digit === "2") {
    return hangupGoodbye(
      "Saving even small amounts regularly helps you handle emergencies and avoid expensive debt. Try saving on the same day you receive income. Goodbye."
    );
  }
  if (digit === "0") {
    return hangupGoodbye("Thank you. Goodbye.");
  }
  return promptMainMenu(menuCallbackUrl);
}
