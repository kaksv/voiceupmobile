/**
 * Africa's Talking Voice XML (Say, GetDigits, Reject).
 * If digit collection never hits your server, try `callBackUrl` instead of `callbackUrl`.
 *
 * GetDigits must have exactly ONE child: either Say or Play (not multiple Say nodes).
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

export type OtpPromptMode = "sms_only" | "sms_and_voice" | "voice_only";

/** Optional `spokenCode`: read digits on the call (pilot / SMS fallback). Code is spoken twice. */
export function promptOtp(
  callbackUrl: string,
  spokenCode?: string,
  mode: OtpPromptMode = "sms_only"
): string {
  const url = escapeXml(callbackUrl);
  if (!spokenCode) {
    const intro =
      "Welcome to the MoMo voice assistant demo. We are sending a six digit code to your phone by SMS. Enter the code using your keypad when you hear the beep.";
    return response(
      `<GetDigits timeout="45" numDigits="6" callbackUrl="${url}">
        ${say(intro)}
    </GetDigits>`
    );
  }

  const spaced = spokenCode.split("").join(", ");
  const firstLine =
    mode === "voice_only"
      ? `Welcome to the MoMo voice assistant demo. We could not use SMS for your code. Your code is: ${spaced}.`
      : `Welcome to the MoMo voice assistant demo. We are sending a six digit code by SMS. Your code is also: ${spaced}.`;
  const repeatLine = `I repeat. Your code is: ${spaced}.`;
  const enterLine =
    "Enter the code using your keypad when you hear the beep. Do not share this code with anyone.";
  const fullPrompt = `${firstLine} ${repeatLine} ${enterLine}`;

  return response(
    `<GetDigits timeout="60" numDigits="6" callbackUrl="${url}">
        ${say(fullPrompt)}
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
    `<GetDigits timeout="25" numDigits="1" callbackUrl="${url}">
        ${say(
          "You are verified. For a demo balance in Ugandan shillings, press 1. For a savings tip, press 2. To try a demo send money flow, press 3. To end the call, press 0."
        )}
    </GetDigits>`
  );
}

/** Amount in whole UGX; caller finishes with hash (#). */
export function promptSendAmount(callbackUrl: string): string {
  const url = escapeXml(callbackUrl);
  return response(
    `<GetDigits timeout="45" numDigits="0" finishOnKey="#" callbackUrl="${url}">
        ${say(
          "Send money demo. Enter the amount in Ugandan shillings using your keypad. Do not include cents. When you have finished, press the hash key."
        )}
    </GetDigits>`
  );
}

export function promptSendAmountRetry(callbackUrl: string): string {
  const url = escapeXml(callbackUrl);
  return response(
    `<GetDigits timeout="45" numDigits="0" finishOnKey="#" callbackUrl="${url}">
        ${say(
          "That amount was not valid. Enter a whole number in Ugandan shillings between five hundred and fifty million, then press the hash key."
        )}
    </GetDigits>`
  );
}

export function promptSendConfirm(callbackUrl: string, amountUgx: number): string {
  const url = escapeXml(callbackUrl);
  const formatted = amountUgx.toLocaleString("en-US");
  return response(
    `<GetDigits timeout="25" numDigits="1" callbackUrl="${url}">
        ${say(
          `You are about to send ${formatted} Ugandan shillings as a demo only. No real money will move. To confirm, press 1. To cancel, press 2.`
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
