import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { agents, users } from "../../db/schema";
import { DrizzleBacktestRepository } from "../backtest/drizzle-repository";
import { evaluatePaperLaunch } from "../backtest/launch-gate";
import { runBacktest } from "../backtest/run";
import type { AppDatabase } from "../db/client";
import type { RecipeV1 } from "../domain/contracts";
import { buildProtectivePutRecipe } from "../hooks/catalog";
import { buildHouseRecipe, isHouseStrategyTemplate } from "../hooks/house-specs";
import { canonicalRecipeHash, validateRecipe } from "../hooks/recipe-validator";
import type { MarketHistoryResult } from "../market/crius-history";
import type { EarningsSnapshot } from "../market/earnings";
import { DrizzlePaperRepository } from "../paper/drizzle-repository";

/**
 * The reserved user that owns OPTRA's public House Agents. Nobody holds a private key for this address, so no
 * wallet session can ever be issued for it: the agents are run by the scheduler, never by a person's session.
 */
export const HOUSE_USER_ADDRESS = "0x0000000000000000000000000000000000004f50";

export type HouseAgentDefinition = {
  /** Stable identity across recipe versions and underlyings. */
  key: string;
  label: string;
  templateId: "protective_put" | "covered_call" | "cash_secured_put" | "earnings_straddle";
  /** The recipe for one underlying. The same builder and the same parameters serve every candidate symbol. */
  recipe: (symbol: string) => RecipeV1;
};

/**
 * Underlyings follow one outcome-independent rule: the first symbol in this fixed liquid-name list whose complete,
 * verified 30-day backtest produces at least one modeled entry (the same launch gate every agent passes). The rule,
 * not the result, picks each symbol; blocked results stay recorded as backtest runs, and no agent card is created for them.
 */
export const HOUSE_SYMBOL_PRIORITY = ["NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "AMD", "PLTR"] as const;

/** Each agent starts its search at the symbol its PM recipe was written for, then follows the shared list. */
const PREFERRED: Record<string, string> = { "optra-covered-call": "NVDA", "optra-cash-secured-put": "TSLA", "optra-protective-put": "NVDA", "optra-earnings-straddle": "NVDA" };

export function candidateSymbols(key: string): string[] {
  const preferred = PREFERRED[key] ?? HOUSE_SYMBOL_PRIORITY[0];
  return [preferred, ...HOUSE_SYMBOL_PRIORITY.filter((symbol) => symbol !== preferred)];
}

export const HOUSE_AGENT_DEFINITIONS: readonly HouseAgentDefinition[] = [
  {
    key: "optra-covered-call",
    label: "Covered Call",
    templateId: "covered_call",
    recipe: (symbol) => buildHouseRecipe("covered_call", { underlyingSymbol: symbol, initialCapitalUsd: 2000, referenceShares: 100, name: `Covered Call ${symbol}` }),
  },
  {
    key: "optra-cash-secured-put",
    label: "Cash-Secured Put",
    templateId: "cash_secured_put",
    recipe: (symbol) => buildHouseRecipe("cash_secured_put", { underlyingSymbol: symbol, initialCapitalUsd: 10_000, name: `Cash-Secured Put ${symbol}` }),
  },
  {
    key: "optra-protective-put",
    label: "Protective Put",
    templateId: "protective_put",
    recipe: (symbol) => buildProtectivePutRecipe({ underlyingSymbol: symbol, protectedShares: "100", initialCapitalUsd: "100000", name: `Protective Put ${symbol}` }),
  },
  {
    key: "optra-earnings-straddle",
    label: "Earnings Straddle",
    templateId: "earnings_straddle",
    recipe: (symbol) => buildHouseRecipe("earnings_straddle", { underlyingSymbol: symbol, initialCapitalUsd: 10_000, name: `Earnings Straddle ${symbol}` }),
  },
];

export type HouseAgentOutcome = {
  key: string;
  status: "running" | "launched" | "draft_waiting_for_data" | "backtest_blocked" | "failed";
  agentId: string | null;
  recipeHash: string;
  underlyingSymbol: string | null;
  reason: string;
};

export type EnsureHouseAgentsDeps = {
  db: AppDatabase;
  getHistory: (symbol: string) => Promise<MarketHistoryResult>;
  getEarnings?: (symbol: string) => Promise<EarningsSnapshot | null>;
  now?: () => Date;
  newRunId?: () => string;
  definitions?: readonly HouseAgentDefinition[];
  /** Overrides the candidate underlyings, for tests. */
  symbols?: (key: string) => string[];
  /**
   * Background passes pass a map so an agent whose every candidate was blocked by its backtest is not re-searched on every
   * pass (each backtest is CPU work). Keys retry after `blockedRetryMs`. A manual provisioning call passes none.
   */
  blockedUntil?: Map<string, number>;
  blockedRetryMs?: number;
  log?: (entry: Record<string, unknown>) => void;
};

async function ensureHouseUser(db: AppDatabase): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.address, HOUSE_USER_ADDRESS)).limit(1);
  if (existing) return existing.id;
  await db.insert(users).values({ address: HOUSE_USER_ADDRESS }).onConflictDoNothing({ target: users.address });
  const [created] = await db.select({ id: users.id }).from(users).where(eq(users.address, HOUSE_USER_ADDRESS)).limit(1);
  if (!created) throw new Error("Unable to create the OPTRA house user.");
  return created.id;
}

/**
 * Idempotently makes sure every OPTRA House Agent exists, has a complete verified backtest, and is running in paper
 * mode. It never fabricates data: when verified history is not ready the agent is not created and the next call
 * retries; a backtest without a modeled entry blocks launch exactly as it would for any user, and the next candidate
 * underlying in the fixed list is tried. Nothing is created until a candidate passes the launch gate.
 */
export async function ensureHouseAgents(deps: EnsureHouseAgentsDeps): Promise<HouseAgentOutcome[]> {
  const now = deps.now ?? (() => new Date());
  const newRunId = deps.newRunId ?? randomUUID;
  const log = deps.log ?? (() => undefined);
  const definitions = deps.definitions ?? HOUSE_AGENT_DEFINITIONS;
  const symbolsFor = deps.symbols ?? candidateSymbols;
  const houseUserId = await ensureHouseUser(deps.db);
  const paper = new DrizzlePaperRepository(deps.db);
  const backtests = new DrizzleBacktestRepository(deps.db);
  const outcomes: HouseAgentOutcome[] = [];

  for (const definition of definitions) {
    const hold = deps.blockedUntil?.get(definition.key);
    if (hold !== undefined && hold > now().getTime()) {
      const placeholder = canonicalRecipeHash(definition.recipe(symbolsFor(definition.key)[0]!));
      outcomes.push({ key: definition.key, status: "backtest_blocked", agentId: null, recipeHash: placeholder, underlyingSymbol: null, reason: "Every candidate underlying was blocked by its launch backtest; the search repeats later." });
      continue;
    }
    const candidates = symbolsFor(definition.key);
    const recipes = candidates.map((symbol) => {
      const recipe = definition.recipe(symbol);
      return { symbol, recipe, recipeHash: canonicalRecipeHash(recipe) };
    });
    const first = recipes[0]!;
    try {
      const invalid = recipes.map((entry) => validateRecipe(entry.recipe)).find((validation) => !validation.valid);
      if (invalid) {
        outcomes.push({ key: definition.key, status: "failed", agentId: null, recipeHash: first.recipeHash, underlyingSymbol: null, reason: `The House Agent recipe is invalid: ${invalid.issues.map((issue) => issue.message).join(" ")}` });
        continue;
      }

      // A running agent for the current recipe version, on any candidate underlying, is already done.
      const current = await deps.db.select().from(agents).where(and(eq(agents.kind, "house"), eq(agents.houseKey, definition.key), eq(agents.status, "running")));
      const running = current.find((row) => recipes.some((entry) => entry.recipeHash === row.recipeHash));
      if (running) {
        outcomes.push({ key: definition.key, status: "running", agentId: running.id, recipeHash: running.recipeHash, underlyingSymbol: running.recipe.underlyingSymbol, reason: "Running in paper mode." });
        continue;
      }

      let last: HouseAgentOutcome | null = null;
      let launched: HouseAgentOutcome | null = null;
      for (const { symbol, recipe, recipeHash } of recipes) {
        const base = { key: definition.key, recipeHash, underlyingSymbol: symbol };
        const history = await deps.getHistory(symbol);
        if (!history.coverage.ready) {
          last = { ...base, status: "draft_waiting_for_data", agentId: null, reason: history.coverage.reason };
          continue;
        }
        const earnings = isHouseStrategyTemplate(definition.templateId) && deps.getEarnings ? await deps.getEarnings(symbol).catch(() => null) : null;
        const run = runBacktest({
          runId: newRunId(), recipe, candles: history.candles, corporateActionDates: history.corporateActionDates, earnings,
          requestedCandles: history.coverage.requestedCandles, now: now().toISOString(),
        });
        const persisted = await backtests.createBacktestRun(houseUserId, recipe, run, history.candles);
        const eligibility = evaluatePaperLaunch({ recipe, recipeHash, backtest: persisted });
        if (!eligibility.allowed) {
          last = { ...base, status: "backtest_blocked", agentId: null, reason: `Launch blocked (${eligibility.reasons.join(", ")}): ${persisted.reason}` };
          continue;
        }

        let [row] = await deps.db.select().from(agents)
          .where(and(eq(agents.kind, "house"), eq(agents.houseKey, definition.key), eq(agents.recipeHash, recipeHash))).limit(1);
        if (!row) {
          try {
            const created = await paper.createAgent({
              ownerId: houseUserId, name: recipe.name, templateId: definition.templateId, status: "draft", recipe, recipeHash, createdAt: now(),
              house: { houseKey: definition.key },
            });
            [row] = await deps.db.select().from(agents).where(eq(agents.id, created.id)).limit(1);
          } catch {
            // A concurrent instance created it first (unique house recipe index): read theirs.
            [row] = await deps.db.select().from(agents)
              .where(and(eq(agents.kind, "house"), eq(agents.houseKey, definition.key), eq(agents.recipeHash, recipeHash))).limit(1);
          }
        }
        if (!row) {
          last = { ...base, status: "failed", agentId: null, reason: "The House Agent record could not be created." };
          break;
        }
        if (row.status === "running") {
          launched = { ...base, status: "running", agentId: row.id, reason: "Running in paper mode." };
          break;
        }
        if (row.status !== "draft") {
          last = { ...base, status: "failed", agentId: row.id, reason: `The agent is ${row.status}; only a draft can be launched.` };
          continue;
        }
        const started = await backtests.launchAgent(houseUserId, row.id, persisted.id, recipeHash, now());
        if (!started) {
          last = { ...base, status: "failed", agentId: row.id, reason: "The agent state changed before launch completed." };
          break;
        }
        // An older recipe version or underlying of the same House Agent is retired so only one of each runs in public.
        for (const other of current) {
          if (other.id !== row.id) await paper.transitionAgent(houseUserId, other.id, "running", "stopped", now());
        }
        launched = { ...base, status: "launched", agentId: row.id, reason: persisted.reason };
        break;
      }
      if (!launched && last?.status === "backtest_blocked" && deps.blockedUntil) deps.blockedUntil.set(definition.key, now().getTime() + (deps.blockedRetryMs ?? 6 * 3_600_000));
      outcomes.push(launched ?? last ?? { key: definition.key, status: "failed", agentId: null, recipeHash: first.recipeHash, underlyingSymbol: null, reason: "No candidate underlying was evaluated." });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[DATABASE_URL]").slice(0, 240) : "Unknown failure.";
      log({ event: "house_agents.failed", key: definition.key, message });
      outcomes.push({ key: definition.key, status: "failed", agentId: null, recipeHash: first.recipeHash, underlyingSymbol: null, reason: message });
    }
  }
  return outcomes;
}
