/**
 * G5 country source. Fail closed: with nothing configured this returns no country.
 *
 * Two trusted sources, tried in order. Neither reads a header the client can set freely.
 *  1. LIVE_GEO_HEADER: the operator names one header and asserts that their edge overwrites it on every request.
 *  2. A server-side IP lookup (LIVE_GEO_LOOKUP_URL with an `{ip}` placeholder) on the client IP that the operator's
 *     own proxy appended. For X-Forwarded-For that is the entry LIVE_GEO_TRUSTED_HOPS from the right (default 1);
 *     entries to its left were supplied by the client and are ignored. LIVE_GEO_IP_HEADER can name a single-value
 *     header instead (for example one the edge overwrites).
 */
export type GeoSource = "edge-header" | "ip-lookup";
export type GeoResult = { country: string | null; source: GeoSource | null };
export const OWNER_JURISDICTION_PROOF_TTL_MS = 15 * 60_000;

const CODE = /^[A-Z]{2}$/;
const cache = new Map<string, { country: string | null; at: number }>();
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;

export function isPublicIp(value: string): boolean {
  const ip = value.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    if (ip.split(".").some((part) => Number(part) > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (/^[0-9a-f:]+$/i.test(ip) && ip.includes(":")) {
    const lower = ip.toLowerCase();
    return !(lower === "::" || lower === "::1" || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") || lower.startsWith("fc") || lower.startsWith("fd"));
  }
  return false;
}

export function trustedClientIp(headers: Headers, env: Record<string, string | undefined>): string | null {
  const single = env.LIVE_GEO_IP_HEADER?.trim();
  if (single && single.toLowerCase() !== "x-forwarded-for") {
    const value = headers.get(single)?.trim() ?? "";
    return isPublicIp(value) ? value : null;
  }
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const hops = Number.parseInt(env.LIVE_GEO_TRUSTED_HOPS ?? "1", 10);
  if (!Number.isInteger(hops) || hops < 1 || hops > chain.length) return null;
  const candidate = chain[chain.length - hops] ?? "";
  return isPublicIp(candidate) ? candidate : null;
}

export async function resolveCountry(headers: Headers, env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch, nowMs: number = Date.now()): Promise<GeoResult> {
  const headerName = env.LIVE_GEO_HEADER?.trim();
  if (headerName) {
    const code = headers.get(headerName)?.trim().toUpperCase() ?? "";
    if (CODE.test(code)) return { country: code, source: "edge-header" };
  }
  const template = env.LIVE_GEO_LOOKUP_URL?.trim();
  if (!template || !template.startsWith("https://") || !template.includes("{ip}")) return { country: null, source: null };
  const ip = trustedClientIp(headers, env);
  if (!ip) return { country: null, source: null };
  const hit = cache.get(ip);
  if (hit && nowMs - hit.at < CACHE_MS) return { country: hit.country, source: hit.country ? "ip-lookup" : null };
  let country: string | null = null;
  try {
    const url = template.replace("{ip}", encodeURIComponent(ip)).replace("{token}", encodeURIComponent(env.LIVE_GEO_LOOKUP_TOKEN ?? ""));
    const response = await fetchImpl(url, { headers: env.LIVE_GEO_LOOKUP_TOKEN ? { authorization: `Bearer ${env.LIVE_GEO_LOOKUP_TOKEN}` } : {}, signal: AbortSignal.timeout(2_500), cache: "no-store" });
    if (response.ok) {
      const body = (await response.json()) as Record<string, unknown>;
      const field = env.LIVE_GEO_LOOKUP_FIELD?.trim() || "country_code";
      const value = typeof body[field] === "string" ? (body[field] as string).trim().toUpperCase() : "";
      country = CODE.test(value) ? value : null;
    }
  } catch {
    country = null;
  }
  // Only a successful answer is cached; a failure retries on the next request instead of locking in "unknown".
  if (country) {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(ip, { country, at: nowMs });
  }
  return { country, source: country ? "ip-lookup" : null };
}

export const clearGeoCacheForTests = () => cache.clear();
