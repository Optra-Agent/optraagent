/** Client-safe: the ceilings are shown in the configuration form and enforced again server-side by the store. */
/** Absolute ceilings no owner policy can exceed, whatever the grant row says. */
export const LIVE_AGENT_HARD_CAPS = {
  maxCollateralPerOrderRaw: 10_000_000n,
  maxOpenCollateralRaw: 25_000_000n,
  maxDailyCollateralRaw: 25_000_000n,
  maxOrdersPerDay: 5,
  maxPendingRequests: 1,
  maxGrantLifetimeMs: 30 * 86_400_000,
  /** A request that never obtained a request key within this window is treated as unknown and halts the agent. */
  maxUnkeyedRequestAgeMs: 10 * 60_000,
} as const;
