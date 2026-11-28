import { ROBINHOOD_MAINNET_CAIP2, parseUsdgToAtomic } from "./atomic";
import { OPTRA_VOLATILITY_PROVIDER_ID } from "./types";
import type { ServiceProvider } from "./types";

/**
 * Default OPTRA-owned x402 Volatility & Market Data Oracle.
 * Honestly disclosed as OPTRA_OWNED, backed by real Crius / Robinhood Chain hourly candle history.
 * Uses Aeron x402 facilitator (`https://x402.aeron.sh`) on Robinhood Chain (eip155:4663) when live settlement is enabled.
 */
export const DEFAULT_SERVICE_PROVIDERS: readonly ServiceProvider[] = [
  {
    id: OPTRA_VOLATILITY_PROVIDER_ID,
    name: "OPTRA Volatility & Regime Oracle",
    endpoint: "/api/x402/providers/volatility",
    serviceCategory: "VOLATILITY_DATA",
    paymentProtocol: "X402",
    acceptedAssets: ["USDG"],
    network: ROBINHOOD_MAINNET_CAIP2,
    payTo: process.env.X402_TREASURY_ADDRESS ?? "0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848",
    status: "ACTIVE",
    trustTier: "OPTRA_VERIFIED",
    ownership: "OPTRA_OWNED",
    expectedResponseSchema: "optra.volatility.v1",
    maxKnownPriceAtomic: parseUsdgToAtomic("0.02"),
    healthCheckUrl: "/api/x402/providers/volatility?health=1",
    metadata: {
      description: "Realized & implied volatility regime oracle backed by verified Robinhood Chain hourly candle history.",
      facilitator: process.env.X402_FACILITATOR_URL ?? "https://x402.aeron.sh",
      disclosure: "OPTRA-owned x402-protected resource backed by live Crius/Robinhood Chain market data.",
    },
  },
];

export function resolveDefaultProvider(providerId: string): ServiceProvider | null {
  return DEFAULT_SERVICE_PROVIDERS.find((provider) => provider.id === providerId) ?? null;
}
