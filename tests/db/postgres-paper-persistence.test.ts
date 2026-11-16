import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../lib/db/client";
import type { AgentDecision } from "../../lib/domain/contracts";
import type { PaperTickContext } from "../../lib/paper/drizzle-repository";
import { buildProtectivePutRecipe } from "../../lib/hooks/catalog";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { DrizzlePaperRepository } from "../../lib/paper/drizzle-repository";
import { users } from "../../db/schema";

const databaseUrl = process.env.OPTRA_TEST_POSTGRES_URL;
const connections: Awaited<ReturnType<typeof createDatabase>>[] = [];

describe.skipIf(!databaseUrl)("PostgreSQL paper persistence", () => {
  afterAll(async () => {
    await Promise.all(connections.map((connection) => connection.close()));
  });

  it("rolls back failed transactions and persists/replays paper Tape atomically", async () => {
    const connection = await createDatabase({ databaseUrl, nodeEnv: "test" });
    connections.push(connection);
    const auth = new DrizzleAuthRepository(connection.db);
    const repository = new DrizzlePaperRepository(connection.db);
    const rollbackAddress = `0x${randomBytes(20).toString("hex")}`;
    await expect(connection.db.transaction(async (tx) => {
      await tx.insert(users).values({ address: rollbackAddress });
      throw new Error("rollback probe");
    })).rejects.toThrow("rollback probe");
    expect(await connection.db.select().from(users).where(eq(users.address, rollbackAddress))).toEqual([]);

    const address = `0x${randomBytes(20).toString("hex")}`;
    const owner = await auth.findOrCreateUser(address as `0x${string}`);
    const createdAt = new Date(Date.now() - 60_000);
    const recipe = buildProtectivePutRecipe({
      underlyingSymbol: "AAPL",
      protectedShares: "10",
      initialCapitalUsd: "100000",
      name: "PostgreSQL persistence probe",
    });
    const agent = await repository.createAgent({
      ownerId: owner.id,
      name: recipe.name,
      templateId: recipe.templateId,
      status: "running",
      recipe,
      recipeHash: canonicalRecipeHash(recipe),
      createdAt,
    });
    const occurredAt = createdAt.toISOString();
    const tickId = `postgres-probe-${randomBytes(8).toString("hex")}`;
    const evaluate = ({ agent: lockedAgent, account, position }: PaperTickContext) => ({
      decision: {
        id: `${lockedAgent.id}:${tickId}`,
        agentId: lockedAgent.id,
        tickId,
        action: "skip",
        reason: "PostgreSQL persistence probe; no order was submitted.",
        hookResults: [],
        snapshotSource: "crius_robinhood_chain_candles",
        recipeHash: lockedAgent.recipeHash,
        createdAt: occurredAt,
      } satisfies AgentDecision,
      orderIntents: [],
      portfolio: { account: account!, position, positionAction: "unchanged" as const },
    });
    const input = { ownerId: owner.id, agentId: agent.id, tickId, occurredAt, snapshot: null, evaluate };

    try {
      await expect(repository.persistTick({
        ...input,
        evaluate: (context) => {
          const result = evaluate(context);
          return {
            ...result,
            portfolio: { ...result.portfolio, account: { ...result.portfolio.account, dailyStartDate: "invalid-date-too-long" } },
          };
        },
      })).rejects.toThrow();
      expect(await repository.listTape(owner.id, agent.id, 10)).toEqual([]);

      const first = await repository.persistTick(input);
      const replay = await repository.persistTick(input);
      expect(first).toMatchObject({ duplicate: false, orderCount: 0, decision: { action: "skip", tickId } });
      expect(replay).toMatchObject({ duplicate: true, orderCount: 0, decision: { action: "skip", tickId } });
      expect(await repository.listTape(owner.id, agent.id, 10)).toHaveLength(1);
      expect(await repository.listOrders(owner.id, agent.id, 10)).toEqual([]);
    } finally {
      await connection.db.delete(users).where(eq(users.id, owner.id));
    }
  });
});
