import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Address } from "viem";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { createDatabase, type DatabaseConnection } from "../../lib/db/client";
import type { Session } from "../../lib/domain/contracts";
import { agents, paperAccounts } from "../../db/schema";
import { createLiveGateHandlers } from "../../lib/live/handlers";
import { loadLiveGateReport } from "../../lib/live/gate-loader";
import { RISK_ACK_STATEMENTS, RISK_ACK_VERSION } from "../../lib/live/gates";

const WALLET = "0x000000000000000000000000000000000000dEaD" as Address;
const NOW = new Date("2026-12-01T00:00:00.000Z");
const ALL_IDS = RISK_ACK_STATEMENTS.map((statement) => statement.id);

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
    expect((await handlers().acknowledge(post({ version: RISK_ACK_VERSION, statementIds: ALL_IDS }))).status).toBe(200);
    const body = (await (await handlers().status(get())).json()) as { gates: Array<{ id: string; pass: boolean }> };
    expect(body.gates.filter((gate) => gate.pass).map((gate) => gate.id)).toEqual(["G7"]);
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

  it("derives G6 from the agent's real launch time and settled expiries, not from anything the owner can set", async () => {
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
    const result = await g6(seasoned);
    expect(result.pass).toBe(true);
    expect(result.detail).toContain("Seasoned");
    expect((await g6()).pass).toBe(true);
  });
});
