import { createHmac, randomInt, timingSafeEqual } from "crypto";

/** 6-digit numeric OTP for the voice pilot. */
export function randomOtpDigits(length = 6): string {
  let s = "";
  for (let i = 0; i < length; i++) {
    s += String(randomInt(0, 10));
  }
  return s;
}

export function hashOtp(plain: string, pepper: string): string {
  return createHmac("sha256", pepper).update(plain, "utf8").digest("hex");
}

export function verifyOtpAgainstHash(
  plain: string,
  storedHexHash: string,
  pepper: string
): boolean {
  if (!storedHexHash) return false;
  const got = hashOtp(plain, pepper);
  try {
    const a = Buffer.from(storedHexHash, "hex");
    const b = Buffer.from(got, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
