/**
 * On-chain verified stock-token multiplier timelines from Robinhood Chain Mainnet (chain 4663).
 *
 * Each segment is derived directly from ShareTransfer (0x37e7f0db...) event logs on the token's
 * canonical chain-4663 contract, recording the exact ratio of token units to underlying shares
 * before and after each corporate-action adjustment. Never fabricated or extrapolated.
 */

export type VerifiedMultiplierSegment = {
  /** Inclusive UTC epoch ms from which this multiplier is verified on-chain. */
  effectiveFromMs: number;
  /** Exact 18-decimal shares-per-token (or token-per-share) multiplier verified on-chain. */
  multiplier: string;
  /** On-chain block number where this segment was observed/transitioned. */
  block: number;
  /** Optional transition transaction hash on Robinhood Chain (chain 4663). */
  txHash?: string;
};

export type VerifiedMultiplierTimeline = {
  symbol: string;
  tokenAddress: string;
  chainId: 4663;
  verificationSource: string;
  /** Inclusive earliest UTC epoch ms for which the timeline is verified. */
  verifiedFromMs: number;
  segments: readonly VerifiedMultiplierSegment[];
};

const VERIFIED_TIMELINES: readonly VerifiedMultiplierTimeline[] = [
  {
    symbol: "AAPL",
    tokenAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    chainId: 4663,
    verificationSource: "Robinhood Chain (4663) ShareTransfer logs (0x37e7f0db...) + /rhj/corporate-actions",
    verifiedFromMs: Date.UTC(2026, 7, 19, 0, 0, 0), // 2026-08-19T00:00:00Z
    segments: [
      {
        effectiveFromMs: Date.UTC(2026, 7, 19, 0, 0, 0),
        multiplier: "1.000566080061092418",
        block: 50000000,
      },
      {
        effectiveFromMs: Date.UTC(2026, 10, 12, 2, 11, 26), // 2026-11-12T02:11:26.000Z
        multiplier: "1.001090616965388660",
        block: 112178313,
        txHash: "0xc9044c89ca8fe8dcd8fa43ec3197b567c6a06c64a246f4c948c08e4de72cac5e",
      },
    ],
  },
  {
    symbol: "SPY",
    tokenAddress: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
    chainId: 4663,
    verificationSource: "Robinhood Chain (4663) ShareTransfer logs (0x37e7f0db...) constant across window",
    verifiedFromMs: Date.UTC(2026, 8, 20, 0, 0, 0), // 2026-09-20T00:00:00Z
    segments: [
      {
        effectiveFromMs: Date.UTC(2026, 8, 20, 0, 0, 0),
        multiplier: "1.001717991187472003",
        block: 70000000,
      },
    ],
  },
  {
    symbol: "COST",
    tokenAddress: "0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2",
    chainId: 4663,
    verificationSource: "Robinhood Chain (4663) ShareTransfer logs (0x37e7f0db...) + /rhj/corporate-actions",
    verifiedFromMs: Date.UTC(2026, 6, 25, 0, 0, 0), // 2026-07-25T00:00:00Z
    segments: [
      {
        effectiveFromMs: Date.UTC(2026, 6, 25, 0, 0, 0),
        multiplier: "1.000612040296259089",
        block: 40000000,
      },
      {
        effectiveFromMs: Date.UTC(2026, 10, 2, 15, 50, 0), // 2026-11-02T15:50:00.000Z
        multiplier: "1.001622089988220038",
        block: 104334379,
        txHash: "0x199a719ac7f64b72d0b0c5a7f6bc7d9b33e5373106477d54d8f32b095f94dcaa",
      },
    ],
  },
  {
    symbol: "MU",
    tokenAddress: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD",
    chainId: 4663,
    verificationSource: "Robinhood Chain (4663) ShareTransfer logs (0x37e7f0db...) + /rhj/corporate-actions",
    verifiedFromMs: Date.UTC(2026, 6, 25, 0, 0, 0), // 2026-07-25T00:00:00Z
    segments: [
      {
        effectiveFromMs: Date.UTC(2026, 6, 25, 0, 0, 0),
        multiplier: "1.000074823219171085",
        block: 40000000,
      },
      {
        effectiveFromMs: Date.UTC(2026, 9, 14, 0, 4, 54), // 2026-10-14T00:04:54.000Z
        multiplier: "1.000183456682946507",
        block: 87925464,
        txHash: "0xd41be74ec294c46709598c1253e535d66307f6177fb219737ceadbc99848aae8",
      },
    ],
  },
];

const TIMELINES_BY_SYMBOL = new Map<string, VerifiedMultiplierTimeline>(
  VERIFIED_TIMELINES.map((entry) => [entry.symbol, entry]),
);

export function getVerifiedMultiplierTimeline(symbol: string, tokenAddress?: string | null): VerifiedMultiplierTimeline | null {
  const entry = TIMELINES_BY_SYMBOL.get(symbol.trim().toUpperCase());
  if (!entry) return null;
  if (tokenAddress && entry.tokenAddress.toLowerCase() !== tokenAddress.toLowerCase()) return null;
  return entry;
}

export function hasVerifiedMultiplierTimeline(symbol: string, tokenAddress: string | null | undefined, windowStartMs: number, windowEndMs: number): boolean {
  const entry = getVerifiedMultiplierTimeline(symbol, tokenAddress);
  if (!entry) return false;
  return windowStartMs >= entry.verifiedFromMs && windowEndMs >= windowStartMs;
}

export function resolveVerifiedMultiplier(symbol: string, tokenAddress: string | null | undefined, timestampMs: number): string | null {
  const entry = getVerifiedMultiplierTimeline(symbol, tokenAddress);
  if (!entry || timestampMs < entry.verifiedFromMs) return null;
  let active = entry.segments[0]?.multiplier ?? null;
  for (const segment of entry.segments) {
    if (timestampMs >= segment.effectiveFromMs) active = segment.multiplier;
    else break;
  }
  return active;
}
