import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { createDatabase } from "../../lib/db/client";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";
import { DrizzlePaperRepository } from "../../lib/paper/drizzle-repository";
import type { AgentDecision, MarketSnapshot, RecipeV1 } from "../../lib/domain/contracts";
import type { PersistTickInput } from "../../lib/paper/drizzle-repository";

const ADDRESS = "0xfcad0b19bb29d4674531d6f115237e16afce377c" as const;
const recipe: RecipeV1 = { version: 1, name: "Preview", templateId: "custom", underlyingSymbol: "AAPL", hookIds: [], parameters: {} };
const snapshot: MarketSnapshot = {
  symbol: "AAPL", source: "robinhood_stock_token_api", observedAt: "2026-11-12T03:30:00.000Z", receivedAt: "2026-11-12T03:31:00.000Z",
  underlyingBidUsd: "355.78", underlyingAskUsd: "356", currentMultiplier: "1.001", tokenBidUsd: "356.16", tokenAskUsd: "356.38",
  currency: "USD", stale: false, tradingHalt: false, pricingMethod: "recorded",
};

function decision(agentId: string, tickId: string, reason: string): AgentDecision {
  return {
    id: `decision:${agentId}:${tickId}`, agentId, tickId, action: "skip", reason, hookResults: [],
    snapshotSource: snapshot.source, recipeHash: canonicalRecipeHash(recipe), createdAt: "2026-11-12T03:31:00.000Z",
  };
}

function tickInput(ownerId: string, agentId: string, tickId: string, reason: string): PersistTickInput {
  return {
    ownerId,
    agentId,
    tickId,
    occurredAt: "2026-11-12T03:31:00.000Z",
    snapshot: null,
    evaluate: ({ account, position }) => ({
      decision: decision(agentId, tickId, reason),
      orderIntents: [],
      portfolio: {
        account: account ?? { initialCapitalUsd: "0", cashUsd: "0", realizedPnlUsd: "0", peakEquityUsd: "0", dailyStartEquityUsd: "0", dailyStartDate: "2026-11-12" },
        position,
        positionAction: "unchanged",
      },
    }),
  };
}

describe("paper ledger persistence", () => {
  let dataDir: string;

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("duplicate_tick_returns_original_decision_and_appends_one_tape_row", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "optra-paper-ledger-"));
    const connection = await createDatabase({ dataDir: join(dataDir, "db"), nodeEnv: "test" });
    try {
      const auth = new DrizzleAuthRepository(connection.db);
      const owner = await auth.findOrCreateUser(ADDRESS);
      const repository = new DrizzlePaperRepository(connection.db);
      const agent = await repository.createAgent({
        ownerId: owner.id, name: "Preview", templateId: "custom", status: "running", recipe,
        recipeHash: canonicalRecipeHash(recipe), createdAt: new Date("2026-11-12T03:00:00.000Z"),
      });

      const results = await Promise.all([
        repository.persistTick({ ...tickInput(owner.id, agent.id, "same-tick", "first result"), snapshot }),
        repository.persistTick({ ...tickInput(owner.id, agent.id, "same-tick", "different retry result"), snapshot }),
      ]);
      const tape = await repository.listTape(owner.id, agent.id);

      expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
      expect(results.filter((result) => result.duplicate)).toHaveLength(1);
      expect(results[0]?.decision).toEqual(results[1]?.decision);
      expect(tape).toHaveLength(1);
      expect(tape[0]).toEqual(results[0]?.decision);
    } finally {
      await connection.close();
    }
  });

  it("hides_agents_and_tape_from_non_owners", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "optra-paper-owner-"));
    const connection = await createDatabase({ dataDir: join(dataDir, "db"), nodeEnv: "test" });
    try {
      const auth = new DrizzleAuthRepository(connection.db);
      const owner = await auth.findOrCreateUser(ADDRESS);
      const other = await auth.findOrCreateUser("0x0000000000000000000000000000000000000001");
      const repository = new DrizzlePaperRepository(connection.db);
      const agent = await repository.createAgent({
        ownerId: owner.id, name: "Preview", templateId: "custom", status: "running", recipe,
        recipeHash: canonicalRecipeHash(recipe), createdAt: new Date("2026-11-12T03:00:00.000Z"),
      });

      await repository.persistTick(tickInput(owner.id, agent.id, "owner-tick", "owner only"));

      await expect(repository.findAgent(other.id, agent.id)).resolves.toBeNull();
      await expect(repository.listTape(other.id, agent.id)).resolves.toEqual([]);
    } finally {
      await connection.close();
    }
  });
});
