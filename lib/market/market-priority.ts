export const MARKET_PRIORITY_SYMBOLS = ["NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "AMD", "PLTR"] as const;

const marketPriority = new Map<string, number>(MARKET_PRIORITY_SYMBOLS.map((symbol, index) => [symbol, index]));
const fallbackPriority = MARKET_PRIORITY_SYMBOLS.length;

export function compareMarketPriority(leftSymbol: string, rightSymbol: string): number {
  return (marketPriority.get(leftSymbol) ?? fallbackPriority) - (marketPriority.get(rightSymbol) ?? fallbackPriority);
}

export function prioritizeMarkets<T extends { symbol: string }>(markets: readonly T[]): T[] {
  return [...markets].sort((left, right) => compareMarketPriority(left.symbol, right.symbol));
}
