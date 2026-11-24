import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { createDatabase, type AppDatabase, type DatabaseConnection } from "../../lib/db/client";
import type { Session } from "../../lib/domain/contracts";
import { agents, liveRiskAcknowledgements, paperAccounts, paperDecisions, paperOrders, paperPositions } from "../../db/schema";
import { createLiveGateHandlers } from "../../lib/live/handlers";
import { loadLiveGateReport } from "../../lib/live/gate-loader";
import { RISK_ACK_STATEMENTS, RISK_ACK_VERSION } from "../../lib/live/gates";

const WALLET = "0x000000000000000000000000000000000000dEaD" as Address;
const OTHER_WALLET = "0x000000000000000000000000000000000000bEEF" as Address;
const NOW = new Date("2026-12-01T00:00:00.000Z");
const ALL_IDS = RISK_ACK_STATEMENTS.map((statement) => statement.id);

type ExpirySettlementFixtureOptions = { orderSeq?: number; expiryAt?: Date; persistPosition?: boolean; openedAt?: Date; orderCreatedAt?: Date };

async function recordExpirySettlement(db: AppDatabase, agentId: string, decisionId: string, tickId: string, decisionCreatedAt: Date, options: ExpirySettlementFixtureOptions = {}) {
  const orderSeq = options.orderSeq ?? 0;
  const orderCreatedAt = options.orderCreatedAt ?? decisionCreatedAt;
  const expiryAt = options.expiryAt ?? new Date(orderCreatedAt.getTime() - 600_000);
  const openedAt = options.openedAt ?? new Date(orderCreatedAt.getTime() - 1_800_000);
  const positionId = randomUUID();
  if (options.persistPosition) {
    await db.insert(paperPositions).values({
      id: positionId, agentId, symbol: "NVDA", optionType: "put", strikeUsd: "100", expiryAt,
      openedAt, closedAt: orderCreatedAt, quantity: "1", averageEntryUsd: "1",
      markPriceUsd: "0", unrealizedPnlUsd: "0", status: "closed", updatedAt: orderCreatedAt,
    });
  }
  await db.insert(paperOrders).values({
    agentId, decisionId, orderSeq, positionId, tickId, symbol: "NVDA", expiryAt, purpose: "expiry_settlement",
    side: "buy", quantity: "1", priceUsd: "0", feeUsd: "0", slippageBps: 0,
    status: "filled", executionMode: "PAPER", createdAt: orderCreatedAt,
  });
}

describe("live gates against a real database", () => {
  const dirs: string[] = [];
  const open: DatabaseConnection[] = [];
  afterEach(async () => {
    for (const connection of open.splice(0)) await connection.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function setup() {
    const root = mkdtempSync(join(tmpdir(), "optra-gates-"));
    dirs.push(root);
    const connection = await createDatabase({ dataDir: join(root, "db"), nodeEnv: "test" });
    open.push(connection);
    const user = await new DrizzleAuthRepository(connection.db).findOrCreateUser(WALLET);
    const session: Session = { user: { id: user.id, address: WALLET }, expiresAt: "2027-01-01T00:00:00.000Z" };
    const handlers = (env: Record<string, string | undefined> = {}) => createLiveGateHandlers({ db: connection.db, readSession: async () => session, now: () => NOW, env });
    return { db: connection.db, ownerId: user.id, handlers };
  }

  const post = (body: unknown, headers: Record<string, string> = {}) => new Request("https://optra.invalid/api/live/gates/acknowledge", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const get = (headers: Record<string, string> = {}) => new Request("https://optra.invalid/api/live/gates", { headers });

  it("starts with every gate that depends on the owner closed, and reports remediation", async () => {
    const { handlers } = await setup();
    const body = (await (await handlers().status(get())).json()) as { allPass: boolean; canEnableLive: boolean; gates: Array<{ id: string; pass: boolean; remediation: string | null }>; venue: { summary: { total: number; verified: number } } };
    expect(body.allPass).toBe(false);
    expect(body.canEnableLive).toBe(false);
    expect(body.gates.every((gate) => !gate.pass && gate.remediation)).toBe(true);
    expect(body.venue.summary.total).toBe(12);
    expect(body.venue.summary.verified).toBeLessThan(12);
  });

  it("records the acknowledgement only when complete and current, and then satisfies G7 only", async () => {
    const { handlers } = await setup();
    expect((await handlers().acknowledge(post({ version: RISK_ACK_VERSION, statementIds: ["total-loss"] }))).status).toBe(400);
    expect((await handlers().acknowledge(post({ version: "2020-01-01.0", statementIds: ALL_IDS }))).status).toBe(409);
    expect((await handlers().acknowledge(post({ version: RISK_ACK_VERSION, statementIds: ALL_IDS, extra: true }))).status).toBe(400);
    expect((await handlers().acknowledge(post({ version: RISK_ACK_VERSION, statementIds: [...ALL_IDS, "not-a-statement"] }))).status).toBe(400);
    expect((await handlers().acknowledge(post({ version: RISK_ACK_VERSION, statementIds: [...ALL_IDS, ALL_IDS[0]] }))).status).toBe(400);
    expect((await handlers().acknowledge(post({ version: RISK_ACK_VERSION, statementIds: ALL_IDS }))).status).toBe(200);
    const body = (await (await handlers().status(get())).json()) as { gates: Array<{ id: string; pass: boolean }> };
    expect(body.gates.filter((gate) => gate.pass).map((gate) => gate.id)).toEqual(["G7"]);
  });

  it("scopes acknowledgements to the authenticated owner and rejects an unauthenticated submission", async () => {
    const { db, ownerId, handlers } = await setup();
    expect((await handlers().acknowledge(post({ version: RISK_ACK_VERSION, statementIds: ALL_IDS }))).status).toBe(200);

    const otherUser = await new DrizzleAuthRepository(db).findOrCreateUser(OTHER_WALLET);
    const otherSession: Session = { user: { id: otherUser.id, address: OTHER_WALLET }, expiresAt: "2027-01-01T00:00:00.000Z" };
    const otherHandlers = createLiveGateHandlers({ db, readSession: async () => otherSession, now: () => NOW });
    const otherBefore = (await (await otherHandlers.status(get())).json()) as { gates: Array<{ id: string; pass: boolean }> };
    expect(otherBefore.gates.find((gate) => gate.id === "G7")?.pass).toBe(false);
    expect((await otherHandlers.acknowledge(post({ version: RISK_ACK_VERSION, statementIds: ALL_IDS }))).status).toBe(200);

    const ownerAfter = (await (await handlers().status(get())).json()) as { gates: Array<{ id: string; pass: boolean }> };
    const otherAfter = (await (await otherHandlers.status(get())).json()) as { gates: Array<{ id: string; pass: boolean }> };
    expect(ownerAfter.gates.find((gate) => gate.id === "G7")?.pass).toBe(true);
    expect(otherAfter.gates.find((gate) => gate.id === "G7")?.pass).toBe(true);

    const anonymous = createLiveGateHandlers({ db, readSession: async () => new Response(null, { status: 401 }), now: () => NOW });
    expect((await anonymous.acknowledge(post({ version: RISK_ACK_VERSION, statementIds: ALL_IDS }))).status).toBe(401);
    const rows = await db.select().from(liveRiskAcknowledgements);
    expect(rows.map((row) => row.ownerId).sort()).toEqual([ownerId, otherUser.id].sort());
  });

  it("refuses an acknowledgement from a blocked country, and stores the country only from the operator's trusted header", async () => {
    const { handlers, db, ownerId } = await setup();
    const env = { LIVE_GEO_HEADER: "cf-ipcountry" };
    expect((await handlers(env).acknowledge(post({ version: RISK_ACK_VERSION, statementIds: ALL_IDS }, { "cf-ipcountry": "US" }))).status).toBe(403);
    // Without a configured header a client-supplied country is ignored: it is stored as unknown and G5 stays closed.
    expect((await handlers({}).acknowledge(post({ version: RISK_ACK_VERSION, statementIds: ALL_IDS }, { "cf-ipcountry": "ID" }))).status).toBe(200);
    const g5 = (await loadLiveGateReport({ db, ownerId, walletAddress: WALLET, country: null, now: NOW, env: {} })).gates.find((gate) => gate.id === "G5");
    expect(g5?.pass).toBe(false);
    const viaHeader = (await (await handlers(env).status(get({ "cf-ipcountry": "ID" }))).json()) as { gates: Array<{ id: string; pass: boolean }> };
    expect(viaHeader.gates.find((gate) => gate.id === "G5")?.pass).toBe(true);
    const spoofedUs = (await (await handlers(env).status(get({ "cf-ipcountry": "US" }))).json()) as { gates: Array<{ id: string; pass: boolean }> };
    expect(spoofedUs.gates.find((gate) => gate.id === "G5")?.pass).toBe(false);
  });

  it("requires a genuine evaluated Paper decision as well as launch age and a settled expiry", async () => {
    const { db, ownerId } = await setup();
    const insert = async (name: string, launchedAt: Date | null, meta: Record<string, unknown>) => {
      const [row] = await db.insert(agents).values({ ownerId, name, templateId: "protective-put", status: "paper", recipe: {} as never, recipeHash: `sha256:${"0".repeat(64)}`, launchedAt }).returning({ id: agents.id });
      await db.insert(paperAccounts).values({ agentId: row!.id, initialCapitalUsd: "1000", cashUsd: "1000", peakEquityUsd: "1000", dailyStartEquityUsd: "1000", dailyStartDate: "2026-11-30", meta });
      return row!.id;
    };
    const g6 = async (agentRef?: string) => (await loadLiveGateReport({ db, ownerId, walletAddress: WALLET, country: "ID", now: NOW, env: {}, ...(agentRef ? { agentRef } : {}) })).gates.find((gate) => gate.id === "G6")!;

    expect((await g6()).pass).toBe(false);
    const fresh = await insert("Fresh", new Date("2026-11-29T00:00:00.000Z"), { settledItm: 1, settledOtm: 0 });
    expect((await g6(fresh)).pass).toBe(false);
    const noExpiry = await insert("No expiry", new Date("2026-11-10T00:00:00.000Z"), { settledItm: 0, settledOtm: 0 });
    expect((await g6(noExpiry)).pass).toBe(false);
    const seasoned = await insert("Seasoned", new Date("2026-11-10T00:00:00.000Z"), { settledItm: 0, settledOtm: 1 });
    expect((await g6(seasoned)).pass).toBe(false);
    await db.insert(paperDecisions).values({
      id: "g6-data-error", agentId: seasoned, tickId: "g6-data-error", action: "skip", reason: "Market data failed.",
      hookResults: [{ hookId: "system.market_data", status: "error", reason: "Candle provenance unavailable." }],
      snapshotSource: "test-fixture", recipeHash: `sha256:${"2".repeat(64)}`, createdAt: new Date("2026-11-30T00:00:00.000Z"),
    });
    expect((await g6(seasoned)).pass).toBe(false);
    await db.insert(paperDecisions).values({
      id: "g6-old-recipe", agentId: seasoned, tickId: "g6-old-recipe", action: "hold", reason: "Previous recipe evaluation.",
      hookResults: [{ hookId: "system.market_data", status: "pass", reason: "Verified candle." }],
      snapshotSource: "test-fixture", recipeHash: `sha256:${"9".repeat(64)}`, createdAt: new Date("2026-11-30T00:30:00.000Z"),
    });
    await recordExpirySettlement(db, seasoned, "g6-old-recipe", "g6-old-recipe", new Date("2026-11-30T00:30:00.000Z"), { persistPosition: true });
    expect((await g6(seasoned)).pass).toBe(false);
    await db.insert(paperDecisions).values({
      id: "g6-evaluated", agentId: seasoned, tickId: "g6-evaluated", action: "hold", reason: "Rules evaluated successfully.",
      hookResults: [{ hookId: "system.market_data", status: "pass", reason: "Verified candle." }],
      snapshotSource: "test-fixture", recipeHash: `sha256:${"0".repeat(64)}`, createdAt: new Date("2026-11-30T01:00:00.000Z"),
    });
    await recordExpirySettlement(db, seasoned, "g6-evaluated", "g6-evaluated", new Date("2026-11-30T01:00:00.000Z"));
    expect((await g6(seasoned)).pass).toBe(false);
    await recordExpirySettlement(db, seasoned, "g6-evaluated", "g6-evaluated", new Date("2026-11-30T01:00:00.000Z"), { orderSeq: 1, expiryAt: new Date("2026-12-02T00:00:00.000Z"), persistPosition: true });
    expect((await g6(seasoned)).pass).toBe(false);
    await recordExpirySettlement(db, seasoned, "g6-evaluated", "g6-evaluated", new Date("2026-11-30T01:00:00.000Z"), { orderSeq: 2, orderCreatedAt: new Date("2026-11-30T01:01:00.000Z"), persistPosition: true });
    expect((await g6(seasoned)).pass).toBe(false);
    await recordExpirySettlement(db, seasoned, "g6-evaluated", "g6-evaluated", new Date("2026-11-30T01:00:00.000Z"), { orderSeq: 3, persistPosition: true, openedAt: new Date("2026-11-09T23:00:00.000Z") });
    expect((await g6(seasoned)).pass).toBe(false);
    await recordExpirySettlement(db, seasoned, "g6-evaluated", "g6-evaluated", new Date("2026-11-30T01:00:00.000Z"), { orderSeq: 4, persistPosition: true });
    await recordExpirySettlement(db, seasoned, "g6-evaluated", "g6-evaluated", new Date("2026-11-30T01:00:00.000Z"), { orderSeq: 5, persistPosition: true });
    const result = await g6(seasoned);
    expect(result.pass).toBe(true);
    expect(result.detail).toContain("1 genuine evaluated decision");
    expect(result.detail).toContain("1 of 1 settled expiry cycle");
    expect(result.detail).toContain("Seasoned");
    expect((await g6()).pass).toBe(true);
  });

  it("counts a running House Agent, which is what the Agents page shows as running, and lists every candidate as evidence", async () => {
    const { db, ownerId } = await setup();
    const [house] = await db.insert(agents).values({ ownerId, name: "Protective Put NVDA", templateId: "protective-put", status: "running", kind: "house", visibility: "public", houseKey: "protective-put-nvda", recipe: {} as never, recipeHash: `sha256:${"1".repeat(64)}`, launchedAt: new Date("2026-11-21T23:28:00.000Z") }).returning({ id: agents.id });
    await db.insert(paperAccounts).values({ agentId: house!.id, initialCapitalUsd: "1000", cashUsd: "1000", peakEquityUsd: "1000", dailyStartEquityUsd: "1000", dailyStartDate: "2026-11-30", meta: { settledItm: 0, settledOtm: 1 } });
    await db.insert(paperDecisions).values({
      id: "house-g6-evaluated", agentId: house!.id, tickId: "house-g6-evaluated", action: "hold", reason: "Rules evaluated successfully.",
      hookResults: [{ hookId: "system.market_data", status: "pass", reason: "Verified candle." }],
      snapshotSource: "test-fixture", recipeHash: `sha256:${"1".repeat(64)}`, createdAt: new Date("2026-11-22T00:00:00.000Z"),
    });
    await recordExpirySettlement(db, house!.id, "house-g6-evaluated", "house-g6-evaluated", new Date("2026-11-22T00:00:00.000Z"), { persistPosition: true });
    const g6 = (await loadLiveGateReport({ db, ownerId, walletAddress: WALLET, country: "ID", now: NOW, env: {} })).gates.find((gate) => gate.id === "G6")!;
    expect(g6.pass).toBe(true);
    expect(g6.detail).toContain("Protective Put NVDA");
    expect(g6.evidence[0]).toContain("(House): launched 2026-11-21");
    const named = (await loadLiveGateReport({ db, ownerId, walletAddress: WALLET, country: "ID", now: new Date("2026-11-25T00:00:00.000Z"), env: {}, agentRef: "protective-put-nvda" })).gates.find((gate) => gate.id === "G6")!;
    expect(named.pass).toBe(false);
    expect(named.evidence[0]).toContain("earliest eligible 2026-11-28");
  });

  it("does not use another owner's private Paper history for G6 when a grant names that agent", async () => {
    const { db, ownerId } = await setup();
    const stranger = await new DrizzleAuthRepository(db).findOrCreateUser(OTHER_WALLET);
    const [agent] = await db.insert(agents).values({
      ownerId: stranger.id, name: "Stranger's seasoned agent", templateId: "protective-put", status: "running",
      recipe: {} as never, recipeHash: `sha256:${"3".repeat(64)}`, launchedAt: new Date("2026-11-10T00:00:00.000Z"),
    }).returning({ id: agents.id });
    await db.insert(paperAccounts).values({
      agentId: agent!.id, initialCapitalUsd: "1000", cashUsd: "1000", peakEquityUsd: "1000", dailyStartEquityUsd: "1000",
      dailyStartDate: "2026-11-30", meta: { settledItm: 0, settledOtm: 1 },
    });
    await db.insert(paperDecisions).values({
      id: "stranger-g6-evaluated", agentId: agent!.id, tickId: "stranger-g6-evaluated", action: "hold", reason: "Rules evaluated successfully.",
      hookResults: [{ hookId: "system.market_data", status: "pass", reason: "Verified candle." }],
      snapshotSource: "test-fixture", recipeHash: `sha256:${"3".repeat(64)}`, createdAt: new Date("2026-11-30T01:00:00.000Z"),
    });

    const report = await loadLiveGateReport({ db, ownerId, walletAddress: WALLET, country: "ID", now: NOW, env: {}, agentRef: agent!.id });
    const g6 = report.gates.find((gate) => gate.id === "G6")!;
    expect(g6.pass).toBe(false);
    expect(g6.detail).toBe("No launched Paper Agent.");
    expect(g6.evidence).toEqual([]);
  });
});
