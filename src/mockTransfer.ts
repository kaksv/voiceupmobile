/**
 * Placeholder until Africa's Talking Payments / MNO APIs are wired.
 */

export function mockTransferReference(): string {
  const n = Date.now().toString(36).toUpperCase();
  return `MOCK-${n}`;
}

export function logMockTransfer(params: {
  phone: string;
  amountUgx: number;
  reference: string;
}): void {
  console.info(
    "[mock-transfer] would debit wallet:",
    JSON.stringify(params, null, 0)
  );
}
