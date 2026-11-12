import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runTick } from "../../lib/engine/run-tick";
import { isRegularEquitySession } from "../../lib/engine/us-market-session";
import { createCriusHistoryFeed } from "../../lib/market/crius-history";
import { buildProtectivePutRecipe } from "../../lib/hooks/catalog";
import { canonicalRecipeHash } from "../../lib/hooks/recipe-validator";

const capture = JSON.parse(await readFile(new URL("../fixtures/aapl-crius-hourly-capture.json", import.meta.url), "utf8")) as {
  capturedAt: string;
  asset: Record<string, unknown>;
  candles: unknown;
  corpActions: unknown[];
};

async function getRealHistory() {
  const feed = createCriusHistoryFeed({
    fetcher: (async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/rhj/corporate-actions") return Response.json({ corpActions: capture.corpActions });
      return Response.json(url.pathname.endsWith("/candles") ? capture.candles : { assets: [capture.asset] });
    }) as typeof fetch,
    now: () => new Date(capture.capturedAt),
    listMarkets: async () => [{ symbol: "AAPL", currentMultiplier: String(capture.asset.currentMultiplier), tokenAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" }],
  });
  return feed.getHistory("AAPL");
}

describe("Protective Put paper evaluator on provider candles", () => {
  it("produces a deterministic modeled order from an actual in-session historical candle", async () => {
    const history = await getRealHistory();
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "10", initialCapitalUsd: "100000" });
    const recipeHash = canonicalRecipeHash(recipe);
    let opened: ReturnType<typeof runTick> | null = null;

    for (let index = 721; index < history.candles.length; index += 1) {
      const currentCandle = history.candles[index]!;
      const result = runTick({
        agentId: "paper-replay-agent",
        tickId: `replay-${currentCandle.endAt}`,
        occurredAt: currentCandle.endAt,
        recipe,
        recipeHash,
        snapshot: null,
        currentCandle,
        history: history.candles.slice(0, index),
        corporateActionDates: history.corporateActionDates,
        state: { status: "running" },
      });
      if (result.decision.action === "open") { opened = result; break; }
    }

    expect(opened).not.toBeNull();
    expect(opened!.orderIntents).toHaveLength(1);
    expect(opened!.orderIntents[0]).toMatchObject({
      action: "open", side: "buy", instrumentType: "modeled_option", optionType: "put",
      modelName: "black_scholes_european_put", premiumSource: "modeled", slippageBps: 50, feeUsd: "0",
    });
    expect(opened!.portfolio.position).toMatchObject({ status: "open", modelName: "black_scholes_european_put", premiumSource: "modeled" });
    expect(opened!.decision.snapshotSource).toBe("crius_robinhood_chain_candles");
    expect(opened!.decision.hookResults.map((hook) => hook.hookId)).toEqual(expect.arrayContaining([
      "calmo", "corpax", "sessia", "percy", "tenora", "coverix", "capra", "trailo", "lastra", "nextra", "haltr", "daylo", "drawra", "exposa", "venux",
    ]));
    expect(opened!.decision.hookResults.find((hook) => hook.hookId === "venux")?.reason).toContain("no option venue quote");
  });

  it("blocks an entry outside regular hours while retaining real history provenance", async () => {
    const history = await getRealHistory();
    const index = history.candles.findIndex((candle, position) => position >= 721 && new Date(candle.endAt).getUTCHours() === 8);
    const currentCandle = history.candles[index]!;
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "10", initialCapitalUsd: "100000" });
    const result = runTick({
      agentId: "paper-replay-agent", tickId: `closed-${currentCandle.endAt}`, occurredAt: currentCandle.endAt,
      recipe, recipeHash: canonicalRecipeHash(recipe), snapshot: null, currentCandle,
      history: history.candles.slice(0, index), corporateActionDates: history.corporateActionDates,
      state: { status: "running" },
    });

    expect(result.decision.action).toBe("skip");
    expect(result.orderIntents).toEqual([]);
    expect(result.decision.hookResults).toContainEqual(expect.objectContaining({ hookId: "sessia", status: "block" }));
  });

  it("continues managing a due exit when Daylo and Drawra block new entries", async () => {
    const history = await getRealHistory();
    const index = history.candles.findIndex((candle, position) => position >= 721 && isRegularEquitySession(candle.endAt));
    const currentCandle = history.candles[index]!;
    const spot = Number(currentCandle.shareCloseUsd);
    const recipe = buildProtectivePutRecipe({ underlyingSymbol: "AAPL", protectedShares: "10", initialCapitalUsd: "100000" });
    const position = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      symbol: "AAPL",
      quantity: "10",
      averageEntryUsd: "1",
      markPriceUsd: "1",
      peakMarkPriceUsd: "1",
      strikeUsd: (spot * 0.93).toFixed(2),
      expiryAt: new Date(new Date(currentCandle.endAt).getTime() + 12 * 60 * 60 * 1000).toISOString(),
      impliedVolatility: "0.3",
      modelName: "black_scholes_european_put" as const,
      premiumSource: "modeled" as const,
      modelInputs: {},
      openedAt: currentCandle.startAt,
      status: "open" as const,
    };
    const result = runTick({
      agentId: "paper-replay-agent", tickId: `due-exit-${currentCandle.endAt}`, occurredAt: currentCandle.endAt,
      recipe, recipeHash: canonicalRecipeHash(recipe), snapshot: null, currentCandle,
      history: history.candles.slice(0, index), corporateActionDates: history.corporateActionDates,
      account: { initialCapitalUsd: "100000", cashUsd: "70000", realizedPnlUsd: "0", peakEquityUsd: "100000", dailyStartEquityUsd: "100000", dailyStartDate: currentCandle.endAt.slice(0, 10) },
      position,
      state: { status: "running" },
    });

    expect(result.decision.action).toBe("close");
    expect(result.orderIntents[0]).toMatchObject({ action: "close", side: "sell" });
    expect(result.decision.hookResults).toContainEqual(expect.objectContaining({ hookId: "daylo", status: "block" }));
    expect(result.decision.hookResults).toContainEqual(expect.objectContaining({ hookId: "drawra", status: "block" }));
  });
});
