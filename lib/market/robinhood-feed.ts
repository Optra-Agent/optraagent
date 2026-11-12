import { z } from "zod";
import { MarketAssetSchema, MarketSnapshotSchema } from "../domain/contracts";
import type { MarketAsset, MarketSnapshot } from "../domain/contracts";

const DEFAULT_BASE_URL = "https://api.robinhood.com";
const ROBINHOOD_CHAIN_ID = 4663;
const DEFAULT_MAX_AGE_MS = 2 * 60 * 1000;

const DecimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/);
const AssetSchema = z.object({
  tokenSymbol: z.string().regex(/^[A-Z0-9.]{1,16}$/),
  tokenName: z.string().min(1),
  status: z.string(),
  currentMultiplier: DecimalSchema,
  pendingMultiplier: z.string().optional(),
  deployments: z.array(z.object({ chainId: z.number().int(), contractAddress: z.string().optional() })),
});
const AssetRegistrySchema = z.object({ assets: z.array(AssetSchema) });
const QuoteSchema = z.object({
  tokenSymbol: z.string(),
  bid: DecimalSchema,
  ask: DecimalSchema,
  currency: z.string(),
  isTradingHalt: z.boolean(),
  generatedAt: z.string().min(1),
  tokenBid: DecimalSchema,
  tokenAsk: DecimalSchema,
  deployments: z.array(z.object({ chainId: z.number().int() })),
});
const QuoteResponseSchema = z.object({ quotes: z.array(QuoteSchema) });

export type MarketFeedErrorCode = "DATA_MISSING" | "UPSTREAM_UNAVAILABLE";

export class MarketFeedError extends Error {
  constructor(readonly code: MarketFeedErrorCode, message: string, readonly retryable: boolean) {
    super(message);
    this.name = "MarketFeedError";
  }
}

export type RobinhoodMarketFeedOptions = {
  fetcher?: typeof fetch;
  now?: () => Date;
  baseUrl?: string;
  maxQuoteAgeMs?: number;
  requestTimeoutMs?: number;
};

function positiveDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value);
}

function compareDecimals(left: string, right: string): number {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftScaled = BigInt(`${leftWhole}${leftFraction.padEnd(scale, "0")}`);
  const rightScaled = BigInt(`${rightWhole}${rightFraction.padEnd(scale, "0")}`);
  return leftScaled === rightScaled ? 0 : leftScaled < rightScaled ? -1 : 1;
}

function isoTimestamp(value: string): string | null {
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

function failUpstream(message = "Robinhood market data is temporarily unavailable."): never {
  throw new MarketFeedError("UPSTREAM_UNAVAILABLE", message, true);
}

export function createRobinhoodMarketFeed(options: RobinhoodMarketFeedOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const maxQuoteAgeMs = options.maxQuoteAgeMs ?? DEFAULT_MAX_AGE_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5000;

  async function getJson(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      return failUpstream();
    }
    if (!response.ok) return failUpstream();
    try {
      return await response.json();
    } catch {
      return failUpstream();
    }
  }

  async function readAssets(): Promise<MarketAsset[]> {
    const parsed = AssetRegistrySchema.safeParse(await getJson(`${baseUrl}/rhj/assets`));
    if (!parsed.success) return failUpstream("Robinhood returned an invalid asset registry.");

    const markets: MarketAsset[] = [];
    for (const asset of parsed.data.assets) {
      if (asset.status !== "ASSET_STATUS_ACTIVE") continue;
      if (!asset.deployments.some((deployment) => deployment.chainId === ROBINHOOD_CHAIN_ID)) continue;
      if (!positiveDecimal(asset.currentMultiplier)) return failUpstream("Robinhood returned an invalid asset multiplier.");
      const market = MarketAssetSchema.safeParse({
        symbol: asset.tokenSymbol,
        name: asset.tokenName,
        currentMultiplier: asset.currentMultiplier,
        tokenAddress: asset.deployments.find((deployment) => deployment.chainId === ROBINHOOD_CHAIN_ID)?.contractAddress,
        ...(asset.pendingMultiplier && positiveDecimal(asset.pendingMultiplier) ? { pendingMultiplier: asset.pendingMultiplier } : {}),
      });
      if (!market.success) return failUpstream("Robinhood returned an invalid asset record.");
      markets.push(market.data);
    }

    const symbols = new Set<string>();
    for (const market of markets) {
      if (symbols.has(market.symbol)) return failUpstream("Robinhood returned duplicate active asset symbols.");
      symbols.add(market.symbol);
    }
    return markets.sort((left, right) => left.symbol.localeCompare(right.symbol));
  }

  return {
    async listMarkets(): Promise<MarketAsset[]> {
      return readAssets();
    },

    async getSnapshot(symbolInput: string): Promise<MarketSnapshot> {
      const symbol = symbolInput.trim().toUpperCase();
      if (!/^[A-Z0-9.]{1,16}$/.test(symbol)) {
        throw new MarketFeedError("DATA_MISSING", "Choose a supported Robinhood Chain market.", false);
      }

      const markets = await readAssets();
      const asset = markets.find((market) => market.symbol === symbol);
      if (!asset) throw new MarketFeedError("DATA_MISSING", `No active Robinhood Chain market is available for ${symbol}.`, false);

      const parsed = QuoteResponseSchema.safeParse(await getJson(`${baseUrl}/rhj/prices/${encodeURIComponent(symbol)}`));
      if (!parsed.success) return failUpstream("Robinhood returned an invalid market quote.");
      const quote = parsed.data.quotes.find((item) => item.tokenSymbol === symbol);
      if (!quote || !quote.deployments.some((deployment) => deployment.chainId === ROBINHOOD_CHAIN_ID)) {
        throw new MarketFeedError("DATA_MISSING", `No current quote is available for ${symbol}.`, true);
      }

      if (
        quote.currency !== "USD" ||
        !positiveDecimal(quote.bid) ||
        !positiveDecimal(quote.ask) ||
        !positiveDecimal(quote.tokenBid) ||
        !positiveDecimal(quote.tokenAsk) ||
        compareDecimals(quote.ask, quote.bid) < 0 ||
        compareDecimals(quote.tokenAsk, quote.tokenBid) < 0
      ) {
        return failUpstream("Robinhood returned a zero, crossed, or unsupported quote.");
      }

      const observedAt = isoTimestamp(quote.generatedAt);
      if (!observedAt) return failUpstream("Robinhood returned an invalid quote timestamp.");
      const receivedAt = now();
      const ageMs = receivedAt.getTime() - new Date(observedAt).getTime();
      const snapshot = MarketSnapshotSchema.safeParse({
        symbol,
        source: "robinhood_stock_token_api",
        observedAt,
        receivedAt: receivedAt.toISOString(),
        underlyingBidUsd: quote.bid,
        underlyingAskUsd: quote.ask,
        currentMultiplier: asset.currentMultiplier,
        tokenBidUsd: quote.tokenBid,
        tokenAskUsd: quote.tokenAsk,
        currency: "USD",
        stale: ageMs < -15_000 || ageMs > maxQuoteAgeMs,
        tradingHalt: quote.isTradingHalt,
        pricingMethod: "recorded",
      });
      if (!snapshot.success) return failUpstream("Robinhood returned a quote outside the supported data contract.");
      return snapshot.data;
    },
  };
}
