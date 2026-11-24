import { describe, expect, it } from "vitest";
import { BETA_CAPS, evaluateLiveGates, readGateEnv, RISK_ACK_STATEMENTS, RISK_ACK_VERSION, type GateInput } from "../../lib/live/gates";
import { CALLPUT_VENUE_CHECKLIST, summarizeVenueChecklist } from "../../lib/live/venue-checklist";

const NOW = new Date("2026-12-01T00:00:00.000Z");
const WALLET = "0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf";
const EVIDENCE = { venueDelegationConfirmedRef: "venue-email-1", onchainGrantRef: "0xabc", auditRef: "audit-1", ownerApprovalRef: "owner-1", revocationTested: true };
const allVerified = CALLPUT_VENUE_CHECKLIST.map((row) => ({ ...row, status: "verified" as const }));

/** A fully satisfied input. Every test then breaks exactly one thing. */
const green = (): GateInput => ({
  now: NOW,
  venue: { rows: allVerified, ownerSignoffRef: "signoff-2026-11-30" },
  custody: { activeGrant: true, route: "callput-account", tradingAddress: "0x0000000000000000000000000000000000000001", evidence: { ...EVIDENCE } },
  accountGates: { openToAll: true, safeMode: false, account: "0x0000000000000000000000000000000000000001", accountCreated: true, accountRegistered: true, accountAllowed: true, accountCanOpen: true, ownerAccountMatch: true, resolverMatchVerified: true, factorySourceVerified: true, accountSourceVerified: true, openPathEnforcementVerified: true, ownerAccountCount: 1, accountUsable: true },
  globalSwitchOn: true,
  ownerStopActive: false,
  wallet: { address: WALLET, allowlist: [WALLET.toLowerCase()] },
  country: "ID",
  geoSource: "edge-header",
  jurisdictionPolicyApprovalRef: "counsel-approval-2026-11-24",
  paper: { launchedAt: new Date("2026-11-20T00:00:00.000Z"), expiryCycles: 1, evaluatedDecisions: 1, agentLabel: "Protective Put" },
  acknowledgement: { version: RISK_ACK_VERSION, acceptedAt: NOW, statementIds: RISK_ACK_STATEMENTS.map((statement) => statement.id) },
});
const failedIds = (input: GateInput) => evaluateLiveGates(input).gates.filter((gate) => !gate.pass).map((gate) => gate.id);

describe("PM live gates G1–G7", () => {
  it("passes only when every gate is satisfied", () => {
    const report = evaluateLiveGates(green());
    expect(report.allPass).toBe(true);
    expect(report.gates.map((gate) => gate.id)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6", "G7"]);
  });

  it("fails G1 until every V item is verified and the owner has signed", () => {
    expect(failedIds({ ...green(), venue: { rows: allVerified, ownerSignoffRef: null } })).toEqual(["G1"]);
    expect(failedIds({ ...green(), venue: { rows: [...allVerified.slice(0, 11), { ...allVerified[11]!, status: "partial" }], ownerSignoffRef: "x" } })).toEqual(["G1"]);
  });

  it("records today's shipped checklist as NOT verified, with V11 partial and V12 open", () => {
    const summary = summarizeVenueChecklist();
    expect(summary.total).toBe(12);
    expect(summary.verified).toBeLessThan(12);
    expect(CALLPUT_VENUE_CHECKLIST.find((row) => row.id === "V11")?.status).toBe("partial");
    expect(CALLPUT_VENUE_CHECKLIST.find((row) => row.id === "V12")?.status).toBe("open");
    expect(evaluateLiveGates({ ...green(), venue: undefined }).gates[0]!.pass).toBe(false);
  });

  it("fails G2 with no grant, with a direct-wallet route, or with any missing evidence", () => {
    expect(failedIds({ ...green(), custody: { activeGrant: false, route: null, evidence: null } })).toContain("G2");
    expect(failedIds({ ...green(), custody: { activeGrant: true, route: "direct-wallet", evidence: { ...EVIDENCE } } })).toContain("G2");
    for (const key of ["venueDelegationConfirmedRef", "onchainGrantRef", "auditRef", "ownerApprovalRef"] as const) {
      expect(failedIds({ ...green(), custody: { activeGrant: true, route: "callput-account", evidence: { ...EVIDENCE, [key]: null } } })).toContain("G2");
    }
    expect(failedIds({ ...green(), custody: { activeGrant: true, route: "callput-account", evidence: { ...EVIDENCE, revocationTested: false } } })).toContain("G2");
  });

  it("fails G2 closed when the current CallPut account-factory state was not read", () => {
    expect(failedIds({ ...green(), accountGates: null })).toContain("G2");
    expect(failedIds({ ...green(), accountGates: undefined })).toContain("G2");
  });

  it("fails G2 when the factory read is for a different Account than the grant", () => {
    const input = green();
    expect(failedIds({ ...input, custody: { ...input.custody, tradingAddress: "0x0000000000000000000000000000000000000002" } })).toContain("G2");
  });

  it("does not treat configured canOpen=true as verified resolver or per-open enforcement", () => {
    const input = green();
    const unverified = {
      ...input.accountGates!,
      resolverMatchVerified: false,
      factorySourceVerified: false,
      accountSourceVerified: false,
      openPathEnforcementVerified: false,
    } as unknown as NonNullable<GateInput["accountGates"]>;
    const g2 = evaluateLiveGates({ ...input, accountGates: unverified }).gates.find((gate) => gate.id === "G2")!;
    expect(g2.pass).toBe(false);
    expect(g2.detail).toContain("canOpen=true");
    expect(g2.detail).not.toContain("Observed configured-factory canOpen=false");
  });

  it("fails G3 when the operator has not switched live on, with the PM message", () => {
    const report = evaluateLiveGates({ ...green(), globalSwitchOn: false });
    expect(report.gates[2]!.pass).toBe(false);
    expect(report.gates[2]!.detail).toBe("Live trading is not open yet. Your agent keeps running on paper.");
  });

  it("keeps G3 closed when the owner's durable emergency stop is active", () => {
    const result = evaluateLiveGates({ ...green(), ownerStopActive: true }).gates.find((gate) => gate.id === "G3")!;
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/owner.*stop.*active/i);
    expect(result.evidence.join(" ")).toMatch(/owner emergency stop is active/i);
  });

  it("fails G4 for a wallet that is not allowlisted, has no wallet, or whose G2 is unmet", () => {
    expect(failedIds({ ...green(), wallet: { address: WALLET, allowlist: [] } })).toEqual(["G4"]);
    expect(failedIds({ ...green(), wallet: { address: null, allowlist: [WALLET] } })).toEqual(["G4"]);
    expect(failedIds({ ...green(), custody: { activeGrant: false, route: null, evidence: null }, wallet: { address: WALLET, allowlist: [WALLET] } })).toEqual(["G2", "G4"]);
  });

  it("fails G5 for the US, embargoed countries, an unknown country and malformed codes", () => {
    for (const country of ["US", "us", "CU", "IR", "KP", "SY"]) expect(failedIds({ ...green(), country })).toEqual(["G5"]);
    for (const country of [null, "", "XX", "T1", "USA", "1"]) expect(failedIds({ ...green(), country })).toEqual(["G5"]);
    expect(failedIds({ ...green(), country: "GB", blockedCountries: ["US", "GB"] })).toEqual(["G5"]);
  });

  it("fails G5 when a country has no current trusted source", () => {
    expect(failedIds({ ...green(), country: "ID", geoSource: null })).toContain("G5");
  });

  it("keeps G5 blocked for scheduled execution without fresh owner-location evidence", () => {
    const gate = evaluateLiveGates({ ...green(), evaluationContext: "scheduled-worker", country: null, geoSource: null }).gates.find((item) => item.id === "G5")!;
    expect(gate.pass).toBe(false);
    expect(gate.detail).toMatch(/scheduled worker.*fresh trusted owner-location evidence/i);
    expect(gate.remediation).toMatch(/owner-bound.*location.*cron caller.*saved acknowledgement/i);
  });

  it("does not mistake a trusted cron-caller country for owner-bound scheduled evidence", () => {
    const gate = evaluateLiveGates({ ...green(), evaluationContext: "scheduled-worker", country: "ID", geoSource: "ip-lookup" }).gates.find((item) => item.id === "G5")!;
    expect(gate.pass).toBe(false);
    expect(gate.detail).toMatch(/scheduled worker.*owner-location evidence/i);
    expect(gate.remediation).toMatch(/owner-bound.*location.*cron caller/i);
  });

  it("keeps G5 closed for an allowed country until counsel approves the final policy", () => {
    const gate = evaluateLiveGates({ ...green(), jurisdictionPolicyApprovalRef: null }).gates.find((item) => item.id === "G5")!;
    expect(gate.pass).toBe(false);
    expect(gate.detail).toMatch(/counsel-approved jurisdiction policy/i);
    expect(gate.remediation).toContain("LIVE_GEO_POLICY_APPROVAL_REF");
  });

  it("allows scheduled G5 only with fresh owner-bound evidence matching the current policy", () => {
    const observedAt = new Date(NOW.getTime() - 60_000).toISOString();
    const proof = {
      country: "ID",
      source: "edge-header" as const,
      observedAt,
      expiresAt: new Date(Date.parse(observedAt) + 15 * 60_000).toISOString(),
      policyRef: "counsel-approval-2026-11-24",
    };
    const gate = (ownerJurisdictionEvidence: typeof proof | null, policyRef = proof.policyRef) => evaluateLiveGates({
      ...green(), evaluationContext: "scheduled-worker", country: null, geoSource: null,
      ownerJurisdictionEvidence, jurisdictionPolicyApprovalRef: policyRef,
    }).gates.find((item) => item.id === "G5")!;

    expect(gate(proof).pass).toBe(true);
    expect(gate({ ...proof, expiresAt: new Date(NOW.getTime() - 1).toISOString() }).pass).toBe(false);
    expect(gate({ ...proof, observedAt: new Date(NOW.getTime() + 1).toISOString() }).pass).toBe(false);
    expect(gate(proof, "different-policy-ref").pass).toBe(false);
    expect(gate({ ...proof, country: "US" }).pass).toBe(false);
    expect(gate(null).pass).toBe(false);
  });

  it("fails G6 under 7 days, with no expiry cycle, or with no launched agent", () => {
    expect(failedIds({ ...green(), paper: { launchedAt: new Date("2026-11-27T00:00:00.000Z"), expiryCycles: 1, evaluatedDecisions: 1, agentLabel: null } })).toEqual(["G6"]);
    expect(failedIds({ ...green(), paper: { launchedAt: new Date("2026-11-01T00:00:00.000Z"), expiryCycles: 0, evaluatedDecisions: 1, agentLabel: null } })).toEqual(["G6"]);
    expect(failedIds({ ...green(), paper: { launchedAt: null, expiryCycles: 3, evaluatedDecisions: 1, agentLabel: null } })).toEqual(["G6"]);
    expect(failedIds({ ...green(), paper: { launchedAt: new Date("2026-11-24T00:00:00.000Z"), expiryCycles: 1, evaluatedDecisions: 0, agentLabel: null } })).toEqual(["G6"]);
    expect(failedIds({ ...green(), paper: { launchedAt: new Date("2026-11-24T00:00:00.000Z"), expiryCycles: 1, evaluatedDecisions: 1, agentLabel: null } })).toEqual([]);
  });

  it("fails G7 with no acknowledgement, a missing statement, or an older wording version", () => {
    const statementIds = RISK_ACK_STATEMENTS.map((statement) => statement.id);
    expect(failedIds({ ...green(), acknowledgement: null })).toEqual(["G7"]);
    expect(failedIds({ ...green(), acknowledgement: { version: RISK_ACK_VERSION, acceptedAt: NOW, statementIds: ["total-loss"] } })).toEqual(["G7"]);
    expect(failedIds({ ...green(), acknowledgement: { version: "2020-01-01.0", acceptedAt: NOW, statementIds } })).toEqual(["G7"]);
    expect(failedIds({ ...green(), acknowledgement: { version: RISK_ACK_VERSION, acceptedAt: NOW, statementIds: [...statementIds, "unknown"] } })).toEqual(["G7"]);
    expect(failedIds({ ...green(), acknowledgement: { version: RISK_ACK_VERSION, acceptedAt: NOW, statementIds: [...statementIds, statementIds[0]!] } })).toEqual(["G7"]);
  });

  it("gives actionable remediation for every failing gate and none for a passing one", () => {
    const report = evaluateLiveGates({ ...green(), globalSwitchOn: false, acknowledgement: null });
    for (const gate of report.gates) expect(gate.remediation === null).toBe(gate.pass);
  });

  it("reads operator settings fail-closed", () => {
    expect(readGateEnv({}).globalSwitchOn).toBe(false);
    expect(readGateEnv({ LIVE_TRADING_ENABLED: "true" }).globalSwitchOn).toBe(true);
    expect(readGateEnv({ LIVE_TRADING_ENABLED: "true", LIVE_AGENT_KILL_SWITCH: "true" }).globalSwitchOn).toBe(false);
    expect(readGateEnv({ LIVE_GEO_EXTRA_BLOCKED: "gb, ca" }).blockedCountries).toEqual(expect.arrayContaining(["US", "GB", "CA"]));
    expect(readGateEnv({ LIVE_GEO_POLICY_APPROVAL_REF: " counsel-2026-11 " }).jurisdictionPolicyApprovalRef).toBe("counsel-2026-11");
  });

  it("attaches factual evidence to every gate, including per-agent Paper history and the live account-factory read", () => {
    const input = green();
    const report = evaluateLiveGates({
      ...input, geoSource: "ip-lookup",
      custody: { ...input.custody, tradingAddress: "0x6b565373726fAA9217B07E067A28Ca81952fB9b3" },
      accountGates: { openToAll: false, safeMode: true, account: "0x6b565373726fAA9217B07E067A28Ca81952fB9b3", accountCreated: false, accountRegistered: false, accountAllowed: false, accountCanOpen: false, ownerAccountCount: 0, accountUsable: false },
      paper: { launchedAt: new Date("2026-11-29T00:00:00.000Z"), expiryCycles: 0, evaluatedDecisions: 0, agentLabel: "Protective Put NVDA", candidates: [{ label: "Protective Put NVDA", kind: "house", launchedAt: new Date("2026-11-29T00:00:00.000Z"), expiryCycles: 0, evaluatedDecisions: 0 }, { label: "Mine", kind: "user", launchedAt: null, expiryCycles: 0, evaluatedDecisions: 0 }] },
    });
    const by = Object.fromEntries(report.gates.map((gate) => [gate.id, gate]));
    expect(by.G1!.evidence).toHaveLength(12);
    expect(by.G2!.evidence[0]).toContain("safe mode on, open to all no");
    expect(by.G2!.pass).toBe(false);
    expect(by.G2!.detail).toContain("Observed configured-factory canOpen=false");
    expect(by.G2!.detail).toContain("resolver and required action with CallPut");
    expect(by.G5!.evidence.join(" ")).toContain("Country source: ip-lookup");
    expect(by.G6!.evidence[0]).toContain("Protective Put NVDA (House): launched 2026-11-29, 2 of 7 days, 0 settled expiries, 0 genuine evaluated decisions, earliest eligible 2026-12-06");
    expect(by.G6!.evidence[1]).toContain("Mine (yours): not launched");
    expect(by.G7!.evidence[0]).toContain(RISK_ACK_VERSION);
  });

  it("keeps the engine's own hard caps at or below the PM beta caps", async () => {
    const { LIVE_AGENT_HARD_CAPS } = await import("../../lib/venue/callput-live-agent-store");
    expect(Number(LIVE_AGENT_HARD_CAPS.maxCollateralPerOrderRaw) / 1e6).toBeLessThanOrEqual(BETA_CAPS.maxPremiumPerPositionUsd);
    expect(Number(LIVE_AGENT_HARD_CAPS.maxDailyCollateralRaw) / 1e6).toBeLessThanOrEqual(BETA_CAPS.newExposurePerUserPerDayUsd);
    expect(Number(LIVE_AGENT_HARD_CAPS.maxOpenCollateralRaw) / 1e6).toBeLessThanOrEqual(BETA_CAPS.capitalPerLiveAgentUsd);
  });
});
