import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearGeoCacheForTests, isPublicIp, resolveCountry, trustedClientIp } from "../../lib/live/geo";

const LOOKUP = { LIVE_GEO_LOOKUP_URL: "https://geo.example/{ip}", LIVE_GEO_LOOKUP_TOKEN: "t0ken" };
const answer = (code: unknown, ok = true) => vi.fn(async () => (ok ? Response.json({ country_code: code }) : new Response("no", { status: 500 }))) as unknown as typeof fetch;

describe("G5 trusted country source", () => {
  beforeEach(() => clearGeoCacheForTests());

  it("returns no country when nothing is configured, whatever headers the client sends", async () => {
    const headers = new Headers({ "cf-ipcountry": "ID", "x-vercel-ip-country": "ID", "x-forwarded-for": "8.8.8.8" });
    expect(await resolveCountry(headers, {})).toEqual({ country: null, source: null });
  });

  it("reads one operator-named header and nothing else, and rejects malformed codes", async () => {
    const env = { LIVE_GEO_HEADER: "x-edge-country" };
    expect(await resolveCountry(new Headers({ "x-edge-country": "id" }), env)).toEqual({ country: "ID", source: "edge-header" });
    expect(await resolveCountry(new Headers({ "x-edge-country": "Indonesia", "cf-ipcountry": "ID" }), env)).toEqual({ country: null, source: null });
  });

  it("uses only the forwarded-for entry the trusted proxy appended, never the client-supplied ones to its left", () => {
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" }), {})).toBe("9.9.9.9");
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 9.9.9.9, 8.8.4.4" }), { LIVE_GEO_TRUSTED_HOPS: "2" })).toBe("9.9.9.9");
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "9.9.9.9" }), { LIVE_GEO_TRUSTED_HOPS: "2" })).toBeNull();
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "9.9.9.9" }), { LIVE_GEO_TRUSTED_HOPS: "0" })).toBeNull();
    expect(trustedClientIp(new Headers({ "x-envoy-external-address": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }), { LIVE_GEO_IP_HEADER: "x-envoy-external-address" })).toBe("9.9.9.9");
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "10.0.0.5" }), {})).toBeNull();
  });

  it("classifies private, loopback and malformed addresses as not public", () => {
    for (const ip of ["10.1.1.1", "127.0.0.1", "192.168.0.4", "172.16.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "256.1.1.1", "::1", "fd00::1", "fe80::1", "not-an-ip", ""]) expect(isPublicIp(ip)).toBe(false);
    for (const ip of ["8.8.8.8", "2606:4700:4700::1111"]) expect(isPublicIp(ip)).toBe(true);
  });

  it("looks the trusted IP up server-side with the token, caches a success and does not cache a failure", async () => {
    const fetchImpl = answer("ID");
    const headers = new Headers({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" });
    expect(await resolveCountry(headers, LOOKUP, fetchImpl)).toEqual({ country: "ID", source: "ip-lookup" });
    expect(await resolveCountry(headers, LOOKUP, fetchImpl)).toEqual({ country: "ID", source: "ip-lookup" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://geo.example/9.9.9.9");
    expect((init as RequestInit).headers).toEqual({ authorization: "Bearer t0ken" });

    clearGeoCacheForTests();
    const failing = answer("ID", false);
    expect(await resolveCountry(headers, LOOKUP, failing)).toEqual({ country: null, source: null });
    expect(await resolveCountry(headers, LOOKUP, failing)).toEqual({ country: null, source: null });
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("fails closed on a bad answer, an unreachable provider, a non-https template, or no trusted IP", async () => {
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9" });
    expect((await resolveCountry(headers, LOOKUP, answer("Indonesia"))).country).toBeNull();
    expect((await resolveCountry(headers, LOOKUP, answer(null))).country).toBeNull();
    expect((await resolveCountry(headers, LOOKUP, (async () => { throw new Error("down"); }) as unknown as typeof fetch)).country).toBeNull();
    expect((await resolveCountry(headers, { ...LOOKUP, LIVE_GEO_LOOKUP_URL: "http://geo.example/{ip}" }, answer("ID"))).country).toBeNull();
    expect((await resolveCountry(new Headers(), LOOKUP, answer("ID"))).country).toBeNull();
  });
});
