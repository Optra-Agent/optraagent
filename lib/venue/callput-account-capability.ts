/**
 * Read-only probe of CallPut's published account/session workflow (the "callput_account" delegation route).
 *
 * It reads the venue's own machine-readable workflow resource over its public MCP endpoint. It sends no
 * transaction, creates no account or grant, holds no key and never calls a tool that prepares an action. The
 * result answers one question: what does the venue itself say it enforces for delegated, session-based trading?
 * It is evidence about the VENUE. It says nothing about whether OPTRA has built, audited or been granted anything.
 */
import { z } from "zod";

export const CALLPUT_MCP_ROBINHOOD_URL = "https://mcp.callput.app/api/mcp?network=robinhood";
export const CALLPUT_ACCOUNT_WORKFLOW_RESOURCE = "callput://account/workflow";

const CapabilitiesSchema = z.object({
  configured: z.boolean(),
  execution_route: z.string(),
  owner_keys_accepted: z.boolean(),
  device_signer_must_differ_from_owner: z.boolean(),
  external_signer_required: z.boolean(),
  storage: z.string(),
  operations: z.array(z.string()),
  session_modes: z.array(z.string()),
  manual_order_cancellation_supported: z.boolean(),
  supported_open_strategies: z.array(z.string()),
  supported_open_underlyings: z.array(z.string()),
  sponsored_deposit_supported: z.boolean(),
  deposit_gas_payer: z.string(),
  trade_native_payer: z.string(),
}).passthrough();

const WorkflowResourceSchema = z.object({ network: z.string(), capabilities: CapabilitiesSchema }).passthrough();

export type CallPutAccountCapability = {
  network: string;
  executionRoute: string;
  configured: boolean;
  ownerKeysAccepted: boolean;
  deviceSignerMustDifferFromOwner: boolean;
  externalSignerRequired: boolean;
  storage: string;
  operations: string[];
  sessionModes: string[];
  manualOrderCancellationSupported: boolean;
  supportedOpenStrategies: string[];
  supportedOpenUnderlyings: string[];
  sponsoredDepositSupported: boolean;
  depositGasPayer: string;
  tradeNativePayer: string;
};

export function parseCallPutAccountCapability(resourceText: string): CallPutAccountCapability {
  let raw: unknown;
  try {
    raw = JSON.parse(resourceText);
  } catch {
    throw new Error("CallPut account workflow resource is not valid JSON.");
  }
  const parsed = WorkflowResourceSchema.safeParse(raw);
  if (!parsed.success) throw new Error("CallPut account workflow resource has an unexpected shape.");
  const c = parsed.data.capabilities;
  return {
    network: parsed.data.network,
    executionRoute: c.execution_route,
    configured: c.configured,
    ownerKeysAccepted: c.owner_keys_accepted,
    deviceSignerMustDifferFromOwner: c.device_signer_must_differ_from_owner,
    externalSignerRequired: c.external_signer_required,
    storage: c.storage,
    operations: c.operations,
    sessionModes: c.session_modes,
    manualOrderCancellationSupported: c.manual_order_cancellation_supported,
    supportedOpenStrategies: c.supported_open_strategies,
    supportedOpenUnderlyings: c.supported_open_underlyings,
    sponsoredDepositSupported: c.sponsored_deposit_supported,
    depositGasPayer: c.deposit_gas_payer,
    tradeNativePayer: c.trade_native_payer,
  };
}

/** Reads the resource through MCP JSON-RPC (`resources/read`). Rejects on any transport or shape failure. */
export async function fetchCallPutAccountCapability(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<CallPutAccountCapability> {
  const response = await fetchImpl(CALLPUT_MCP_ROBINHOOD_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: CALLPUT_ACCOUNT_WORKFLOW_RESOURCE } }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`CallPut MCP responded with HTTP ${response.status}.`);
  const text = await response.text();
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) throw new Error("CallPut MCP returned no JSON body.");
  const envelope = z.object({ result: z.object({ contents: z.array(z.object({ text: z.string().optional() }).passthrough()) }) }).safeParse(JSON.parse(match[0]));
  if (!envelope.success) throw new Error("CallPut MCP returned an unexpected envelope.");
  return parseCallPutAccountCapability(envelope.data.result.contents.map((part) => part.text ?? "").join(""));
}

export type DelegationFinding = { id: string; ok: boolean; detail: string };

/**
 * What the venue ENFORCES for a delegated session, for one underlying and strategy. Every `ok: false` finding is a
 * reason delegated execution must stay off. Findings about OPTRA's own readiness are separate (autonomyBlockers).
 */
export function assessVenueDelegation(cap: CallPutAccountCapability, target: { underlying: string; strategy: string }): DelegationFinding[] {
  const has = (list: string[], value: string) => list.includes(value);
  return [
    { id: "account-route", ok: cap.configured && cap.executionRoute === "callput_account" && cap.network === "robinhood", detail: `execution route ${cap.executionRoute} on ${cap.network}, configured=${cap.configured}.` },
    { id: "scoped-instrument", ok: has(cap.supportedOpenUnderlyings, target.underlying.toUpperCase()) && has(cap.supportedOpenStrategies, target.strategy), detail: `a grant is bound to one underlying and one spread strategy; ${target.underlying} ${target.strategy} supported=${has(cap.supportedOpenUnderlyings, target.underlying.toUpperCase()) && has(cap.supportedOpenStrategies, target.strategy)}.` },
    { id: "session-modes", ok: has(cap.sessionModes, "open_close") && has(cap.sessionModes, "close_only"), detail: `session modes: ${cap.sessionModes.join(", ")} (close_only grants no open allowance).` },
    { id: "distinct-device-signer", ok: cap.deviceSignerMustDifferFromOwner && !cap.ownerKeysAccepted, detail: "the session signer must differ from the owner and owner keys are never accepted by the service." },
    { id: "owner-revocation", ok: has(cap.operations, "revoke") && has(cap.operations, "recover"), detail: `owner-signed revoke and proof-based recover are offered (operations: ${cap.operations.join(", ")}).` },
    { id: "external-signing", ok: cap.externalSignerRequired, detail: "the service never signs; an external wallet or local device signer must." },
    { id: "no-manual-cancel", ok: !cap.manualOrderCancellationSupported, detail: "a submitted request cannot be cancelled by the user; only the keeper can cancel it (informational, matches the app's behavior)." },
  ];
}
