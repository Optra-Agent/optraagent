import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import type { Session } from "../../lib/domain/contracts";
import { createDatabase } from "../../lib/db/client";
import { createCallPutOrderHandlers } from "../../lib/venue/callput-order-ledger";

const WALLET_A = "0xfcad0b19bb29d4674531d6f115237e16afce377c" as const;
const WALLET_B = "0xfa0426d7ad93f4f1e990bd4c1103c771344ada17" as const;
const INTENT_ID = "123e4567-e89b-42d3-a456-426614174000";
const intent = {
  version: 1,
  chainId: 4663,
  account: WALLET_A,
  kind: "open",
  strategy: "BuyPutSpread",
  underlying: "AAPL",
  underlyingAssetIndex: 16,
  longOptionId: `0x${"11".repeat(32)}`,
  shortOptionId: `0x${"22".repeat(32)}`,
  expiry: 1_795_798_800,
  sizeRaw: "1000000000000000000",
  minSizeRaw: "780000000000000000",
  amountInRaw: "5000000",
  createdAtMs: 1_795_201_042_000,
} as const;

function request(body?: unknown, method = "GET") {
  return new Request("https://optra.invalid/api/venue/callput/orders", {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

describe("durable CallPut order records", () => {
  let rootDir: string;

  afterEach(() => {
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
  });

  it("persists an authenticated order intent and replays the same idempotency key", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-callput-ledger-"));
    const first = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    const auth = new DrizzleAuthRepository(first.db);
    const owner = await auth.findOrCreateUser(WALLET_A);
    const session: Session = { user: { id: owner.id, address: WALLET_A }, expiresAt: "2027-01-01T00:00:00.000Z" };
    const handlers = createCallPutOrderHandlers({ db: first.db, readSession: async () => session });

    const created = await handlers.create(request({ clientIntentId: INTENT_ID, intent }, "POST"));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ order: { clientIntentId: INTENT_ID, account: WALLET_A, chainId: 4663, intent } });

    const replay = await handlers.create(request({ clientIntentId: INTENT_ID, intent }, "POST"));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ idempotentReplay: true, order: { clientIntentId: INTENT_ID } });
    await first.close();

    const second = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    try {
      const restored = await createCallPutOrderHandlers({ db: second.db, readSession: async () => session }).list(request());
      expect(restored.status).toBe(200);
      expect(await restored.json()).toMatchObject({ orders: [{ clientIntentId: INTENT_ID, intent }] });
    } finally {
      await second.close();
    }
  });

  it("rejects a transaction intent whose account is not the authenticated wallet", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-callput-ledger-owner-"));
    const connection = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    try {
      const auth = new DrizzleAuthRepository(connection.db);
      const owner = await auth.findOrCreateUser(WALLET_B);
      const session: Session = { user: { id: owner.id, address: WALLET_B }, expiresAt: "2027-01-01T00:00:00.000Z" };
      const handlers = createCallPutOrderHandlers({ db: connection.db, readSession: async () => session });
      const response = await handlers.create(request({ clientIntentId: INTENT_ID, intent }, "POST"));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    } finally {
      await connection.close();
    }
  });

  it("rejects reuse of an idempotency key for different order data", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-callput-ledger-conflict-"));
    const connection = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    try {
      const auth = new DrizzleAuthRepository(connection.db);
      const owner = await auth.findOrCreateUser(WALLET_A);
      const session: Session = { user: { id: owner.id, address: WALLET_A }, expiresAt: "2027-01-01T00:00:00.000Z" };
      const handlers = createCallPutOrderHandlers({ db: connection.db, readSession: async () => session });
      const first = await handlers.create(request({ clientIntentId: INTENT_ID, intent }, "POST"));
      expect(first.status).toBe(201);
      const conflicting = await handlers.create(request({ clientIntentId: INTENT_ID, intent: { ...intent, amountInRaw: "6000000" } }, "POST"));
      expect(conflicting.status).toBe(409);
      expect(await conflicting.json()).toMatchObject({ error: { code: "CONFLICT" } });
    } finally {
      await connection.close();
    }
  });

  it("stores transaction references as unverified recovery data and deduplicates event retries", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-callput-ledger-events-"));
    const connection = await createDatabase({ dataDir: join(rootDir, "db"), nodeEnv: "test" });
    try {
      const auth = new DrizzleAuthRepository(connection.db);
      const owner = await auth.findOrCreateUser(WALLET_A);
      const session: Session = { user: { id: owner.id, address: WALLET_A }, expiresAt: "2027-01-01T00:00:00.000Z" };
      const handlers = createCallPutOrderHandlers({ db: connection.db, readSession: async () => session });
      const created = await handlers.create(request({ clientIntentId: INTENT_ID, intent }, "POST"));
      const orderId = (await created.json() as { order: { id: string } }).order.id;
      const event = {
        eventId: "123e4567-e89b-42d3-a456-426614174001",
        referenceKind: "transaction",
        transactionKind: "open-spread",
        transactionHash: `0x${"ab".repeat(32)}`,
      };

      const appended = await handlers.appendEvent(request(event, "POST"), orderId);
      expect(appended.status).toBe(201);
      expect(await appended.json()).toMatchObject({ event: { ...event, verification: "client-reported-reference" } });

      const replay = await handlers.appendEvent(request(event, "POST"), orderId);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ idempotentReplay: true });
      const listed = await handlers.list(request());
      expect(await listed.json()).toMatchObject({ orders: [{ events: [{ transactionHash: event.transactionHash, verification: "client-reported-reference" }] }] });
    } finally {
      await connection.close();
    }
  });
});
