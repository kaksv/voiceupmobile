/**
 * One JSON line per log for grep / log drains (Render, etc.).
 * Never log OTPs, full DTMF, or raw SMS bodies.
 */

export function maskPhoneE164(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "****";
  return `***${d.slice(-4)}`;
}

export function voiceLog(entry: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    svc: "voice",
    ...entry,
  });
  console.info(line);
}
