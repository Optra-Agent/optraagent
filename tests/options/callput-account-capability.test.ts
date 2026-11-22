import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  CALLPUT_ACCOUNT_WORKFLOW_RESOURCE,
  assessVenueDelegation,
  fetchCallPutAccountCapability,
  parseCallPutAccountCapability,
} from "../../lib/venue/callput-account-capability";

// Captured verbatim from the hosted CallPut MCP resource callput://account/workflow on 2026-11-22.
const resourceText = readFileSync("tests/options/fixtures/callput-account-workflow-resource-20261122.json", "utf8");

describe("CallPut account/session capability (read-only venue evidence)", () => {
  it("parses the venue's real workflow resource", () => {
    const cap = parseCallPutAccountCapability(resourceText);
    expect(cap.network).toBe("robinhood");
    expect(cap.executionRoute).toBe("callput_account");
    expect(cap.sessionModes).toEqual(["open_close", "close_only"]);
    expect(cap.operations).toEqual(expect.arrayContaining(["open", "close", "settle", "revoke", "recover"]));
    expect(cap.deviceSignerMustDifferFromOwner).toBe(true);
    expect(cap.ownerKeysAccepted).toBe(false);
    expect(cap.manualOrderCancellationSupported).toBe(false);
    expect(cap.supportedOpenUnderlyings).toContain("AAPL");
  });

  it("reports every venue-side delegation property as satisfied for AAPL BuyPutSpread", () => {
    const findings = assessVenueDelegation(parseCallPutAccountCapability(resourceText), { underlying: "AAPL", strategy: "BuyPutSpread" });
    expect(findings.filter((f) => !f.ok)).toEqual([]);
    expect(findings.map((f) => f.id)).toEqual(expect.arrayContaining(["account-route", "scoped-instrument", "distinct-device-signer", "owner-revocation"]));
  });

  it("flags an unsupported instrument and a weakened signer rule instead of passing", () => {
    const weak = JSON.parse(resourceText) as { capabilities: Record<string, unknown> };
    weak.capabilities.owner_keys_accepted = true;
    const findings = assessVenueDelegation(parseCallPutAccountCapability(JSON.stringify(weak)), { underlying: "ZZZZ", strategy: "BuyPutSpread" });
    expect(findings.find((f) => f.id === "scoped-instrument")?.ok).toBe(false);
    expect(findings.find((f) => f.id === "distinct-device-signer")?.ok).toBe(false);
  });

  it("rejects malformed resources", () => {
    expect(() => parseCallPutAccountCapability("not json")).toThrow(/not valid JSON/);
    expect(() => parseCallPutAccountCapability(JSON.stringify({ network: "robinhood" }))).toThrow(/unexpected shape/);
  });

  it("reads the resource over MCP JSON-RPC and never sends anything but resources/read", async () => {
    const envelope = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { contents: [{ uri: CALLPUT_ACCOUNT_WORKFLOW_RESOURCE, text: resourceText }] } });
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ method: "resources/read", params: { uri: CALLPUT_ACCOUNT_WORKFLOW_RESOURCE } });
      return new Response(envelope, { status: 200 });
    });
    const cap = await fetchCallPutAccountCapability(fetchMock as unknown as typeof fetch);
    expect(cap.executionRoute).toBe("callput_account");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects on HTTP errors and bad envelopes", async () => {
    await expect(fetchCallPutAccountCapability((async () => new Response("no", { status: 503 })) as unknown as typeof fetch)).rejects.toThrow(/HTTP 503/);
    await expect(fetchCallPutAccountCapability((async () => new Response("{\"result\":{}}", { status: 200 })) as unknown as typeof fetch)).rejects.toThrow(/unexpected envelope/);
  });
});
