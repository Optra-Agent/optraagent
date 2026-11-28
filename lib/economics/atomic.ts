/**
 * Integer atomic-unit arithmetic for USDG (6 decimals: 1 USDG = 1_000_000 atomic units).
 * Financial accounting in OPTRA's Economic Core never uses floating-point arithmetic.
 */
export const USDG_DECIMALS = 6;
export const USDG_ATOMIC_SCALE = 1_000_000n;
export const USDG_ADDRESS_MAINNET = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const;
export const ROBINHOOD_MAINNET_CAIP2 = "eip155:4663" as const;
export const ROBINHOOD_TESTNET_CAIP2 = "eip155:46630" as const;

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;
const ATOMIC_RE = /^\d+$/;

export function assertAtomicString(value: string, label = "amount"): bigint {
  if (!ATOMIC_RE.test(value)) {
    throw new Error(`Invalid atomic integer ${label}: "${value}".`);
  }
  return BigInt(value);
}

export function parseUsdgToAtomic(decimalInput: string): string {
  const trimmed = decimalInput.trim();
  const match = DECIMAL_RE.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid USDG decimal amount: "${decimalInput}".`);
  }
  const whole = match[1] ?? "0";
  const frac = (match[2] ?? "").slice(0, USDG_DECIMALS).padEnd(USDG_DECIMALS, "0");
  if ((match[2] ?? "").length > USDG_DECIMALS) {
    const extra = (match[2] ?? "").slice(USDG_DECIMALS);
    if (/[^0]/.test(extra)) {
      throw new Error(`USDG precision exceeds ${USDG_DECIMALS} decimals: "${decimalInput}".`);
    }
  }
  const atomic = BigInt(whole) * USDG_ATOMIC_SCALE + BigInt(frac);
  return atomic.toString();
}

export function formatAtomicToUsdg(atomicInput: string | bigint, minFractionDigits = 2): string {
  const value = typeof atomicInput === "bigint" ? atomicInput : assertAtomicString(atomicInput);
  const whole = value / USDG_ATOMIC_SCALE;
  const remainder = value % USDG_ATOMIC_SCALE;
  const padded = remainder.toString().padStart(USDG_DECIMALS, "0");
  const trimmed = padded.replace(/0+$/, "");
  const frac = trimmed.length >= minFractionDigits ? trimmed : padded.slice(0, minFractionDigits);
  return frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString();
}

export function addAtomic(a: string, b: string): string {
  return (assertAtomicString(a, "left") + assertAtomicString(b, "right")).toString();
}

export function subAtomic(a: string, b: string): string {
  const left = assertAtomicString(a, "left");
  const right = assertAtomicString(b, "right");
  if (left < right) {
    throw new Error(`Atomic underflow: ${a} < ${b}.`);
  }
  return (left - right).toString();
}

export function cmpAtomic(a: string, b: string): -1 | 0 | 1 {
  const left = assertAtomicString(a, "left");
  const right = assertAtomicString(b, "right");
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function minAtomic(a: string, b: string): string {
  return cmpAtomic(a, b) <= 0 ? a : b;
}
