const utcFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Deterministic UTC rendering so server and client markup never disagree. */
export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${utcFormatter.format(date).replace(",", " ·")} UTC`;
}

export function shortHash(hash: string, head = 14, tail = 6): string {
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatUsd(value: string, maximumFractionDigits = 2): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `$${value}`;
  const sign = parsed < 0 ? "-" : "";
  return `${sign}$${Math.abs(parsed).toLocaleString("en-US", { minimumFractionDigits: Math.min(2, maximumFractionDigits), maximumFractionDigits })}`;
}

export function signedTone(value: string): "gain" | "loss" | "flat" {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "flat";
  return parsed > 0 ? "gain" : "loss";
}

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** User-facing text for a caught value. Schema-parse failures never leak raw validation JSON to the screen. */
export function errorText(reason: unknown, fallback: string): string {
  if (!(reason instanceof Error)) return fallback;
  if (reason.name === "ZodError") return `${fallback} The server response was not in the expected format.`;
  return reason.message || fallback;
}

/** Readable percentage for display (default 2 decimals). The full-precision string stays in the data and in `title` attributes. */
export function formatPct(value: string, digits = 2): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `${value}%`;
  const text = parsed.toFixed(digits);
  return `${parsed > 0 ? "+" : ""}${text === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : text}%`;
}

export function formatPoints(value: string, digits = 2): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `${value} pp`;
  return `${parsed > 0 ? "+" : ""}${parsed.toFixed(digits)} pp`;
}
