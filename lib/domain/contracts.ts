import { z } from "zod";

export const EvmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((address) => address.toLowerCase() as `0x${string}`);
export const DecimalStringSchema = z.string().regex(/^\d+(?:\.\d+)?$/);
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const ApiErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "DATA_MISSING",
  "STALE_MARKET_DATA",
  "UNSUPPORTED_HOOK",
  "BACKTEST_REQUIRED",
  "CONFLICT",
  "UPSTREAM_UNAVAILABLE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
}).strict();

export const AuthenticatedWalletUserSchema = z.object({
  id: z.string().min(1),
  address: EvmAddressSchema,
}).strict();

export const SessionSchema = z.object({
  user: AuthenticatedWalletUserSchema,
  expiresAt: IsoDateTimeSchema,
}).strict();

export const MarketSnapshotSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9.]{1,16}$/),
  source: z.literal("robinhood_stock_token_api"),
  observedAt: IsoDateTimeSchema,
  receivedAt: IsoDateTimeSchema,
  underlyingBidUsd: DecimalStringSchema,
  underlyingAskUsd: DecimalStringSchema,
  currentMultiplier: DecimalStringSchema,
  tokenBidUsd: DecimalStringSchema,
  tokenAskUsd: DecimalStringSchema,
  currency: z.literal("USD"),
  stale: z.boolean(),
  tradingHalt: z.boolean(),
  pricingMethod: z.enum(["recorded", "modeled", "unavailable"]),
}).strict();

export const MarketCandleSourceSchema = z.literal("crius_robinhood_chain_candles");
export const MarketCandleSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9.]{1,16}$/),
  source: MarketCandleSourceSchema,
  tokenAddress: EvmAddressSchema,
  interval: z.literal("1h"),
  startAt: IsoDateTimeSchema,
  endAt: IsoDateTimeSchema,
  receivedAt: IsoDateTimeSchema,
  tokenOpenUsd: DecimalStringSchema,
  tokenHighUsd: DecimalStringSchema,
  tokenLowUsd: DecimalStringSchema,
  tokenCloseUsd: DecimalStringSchema,
  shareOpenUsd: DecimalStringSchema,
  shareHighUsd: DecimalStringSchema,
  shareLowUsd: DecimalStringSchema,
  shareCloseUsd: DecimalStringSchema,
  multiplierSharesPerToken: DecimalStringSchema,
  multiplierStatus: z.enum(["stable_verified", "action_in_window", "unverified"]),
  tradeCount: z.number().int().positive(),
  volumeUsd: DecimalStringSchema,
  poolCount: z.number().int().nonnegative(),
  filled: z.literal(false),
}).strict();

export const MarketHistoryCoverageSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9.]{1,16}$/),
  source: MarketCandleSourceSchema,
  tokenAddress: EvmAddressSchema.nullable(),
  requestedCandles: z.number().int().positive(),
  availableCandles: z.number().int().nonnegative(),
  requiredCandles: z.number().int().positive(),
  consecutiveHours: z.number().int().nonnegative(),
  startAt: IsoDateTimeSchema.nullable(),
  endAt: IsoDateTimeSchema.nullable(),
  ready: z.boolean(),
  multiplierStatus: z.enum(["stable_verified", "action_in_window", "unverified"]),
  fillApplied: z.literal(false),
  reason: z.string().min(1),
}).strict();

export const MarketAssetSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9.]{1,16}$/),
  name: z.string().min(1),
  currentMultiplier: DecimalStringSchema,
  tokenAddress: EvmAddressSchema.optional(),
  pendingMultiplier: DecimalStringSchema.optional(),
}).strict();

export const MarketListSchema = z.object({
  markets: z.array(MarketAssetSchema),
}).strict();

export const HookStageSchema = z.enum(["gate", "strike", "size", "pulse", "expiry", "breaker"]);

export const HookDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  stage: HookStageSchema,
  availability: z.enum(["implemented", "catalog_only"]),
  summary: z.string().min(1),
  implementationNote: z.string().min(1).optional(),
  unavailableReason: z.string().min(1).optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const HookResultSchema = z.object({
  hookId: z.string().min(1),
  status: z.enum(["pass", "block", "select", "size", "action", "noop", "error", "fail", "skip"]),
  reason: z.string().min(1),
  observedValue: z.string().optional(),
  stage: HookStageSchema.optional(),
  value: z.union([z.string(), z.number()]).optional(),
  threshold: z.union([z.string(), z.number()]).optional(),
  unit: z.string().optional(),
  text: z.string().optional(),
  dataRefs: z.array(z.string()).optional(),
}).strict();

export const HookCatalogCoverageSchema = z.object({
  sourceStatus: z.enum(["available", "source_unavailable"]),
  expectedCount: z.number().int().nonnegative(),
  registeredCount: z.number().int().nonnegative(),
  expectedByStage: z.object({
    gate: z.number().int().nonnegative(),
    strike: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    pulse: z.number().int().nonnegative(),
    expiry: z.number().int().nonnegative(),
    breaker: z.number().int().nonnegative(),
  }).strict(),
  unavailableReason: z.string().min(1).optional(),
}).strict();

export const HookCatalogResponseSchema = z.object({
  coverage: HookCatalogCoverageSchema,
  definitions: z.array(HookDefinitionSchema),
}).strict();

export const RecipeValidationIssueSchema = z.object({
  code: z.enum([
    "INVALID_RECIPE",
    "HOOK_CATALOG_UNAVAILABLE",
    "UNSUPPORTED_HOOK",
    "DUPLICATE_HOOK_ID",
    "MISSING_REQUIRED_HOOK",
    "INVALID_COMPOSITION",
    "INVALID_PARAMETER",
  ]),
  message: z.string().min(1),
  hookId: z.string().optional(),
}).strict();

export const RecipeValidationResultSchema = z.object({
  valid: z.boolean(),
  recipeHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  issues: z.array(RecipeValidationIssueSchema),
}).strict();

export const HouseAgentTemplateIdSchema = z.enum([
  "covered_call",
  "cash_secured_put",
  "protective_put",
  "earnings_straddle",
  "custom",
]);

export const HouseAgentTemplateSchema = z.object({
  id: z.enum(["covered_call", "cash_secured_put", "protective_put", "earnings_straddle"]),
  name: z.string().min(1),
  availability: z.enum(["paper_ready", "preview"]),
  reason: z.string().min(1),
}).strict();
export const HouseAgentTemplateCatalogResponseSchema = z.object({ templates: z.array(HouseAgentTemplateSchema) }).strict();

export const RecipeV1Schema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(80),
  templateId: HouseAgentTemplateIdSchema,
  underlyingSymbol: z.string().regex(/^[A-Z0-9.]{1,16}$/),
  hookIds: z.array(z.string().min(1)).max(36),
  parameters: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const AgentSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  name: z.string().min(1),
  templateId: HouseAgentTemplateIdSchema,
  status: z.enum(["draft", "running", "paused", "stopped"]),
  recipeHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  backtestRunId: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict();

export const AgentDetailSchema = AgentSchema.extend({ recipe: RecipeV1Schema }).strict();
export const AgentListResponseSchema = z.object({ agents: z.array(AgentSchema) }).strict();
export const AgentCreateInputSchema = z.object({ recipe: RecipeV1Schema }).strict();
export const AgentLifecycleInputSchema = z.object({ action: z.enum(["pause", "resume", "stop"]) }).strict();
export const AgentForkInputSchema = z.object({ name: z.string().trim().min(1).max(80).optional() }).strict();

export const AgentDecisionSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  tickId: z.string().min(1),
  action: z.enum(["open", "hold", "close", "skip"]),
  reason: z.string().min(1),
  hookResults: z.array(HookResultSchema),
  marketContext: z.record(z.string(), z.unknown()).optional(),
  snapshotSource: z.string().min(1),
  recipeHash: z.string().min(1),
  createdAt: IsoDateTimeSchema,
}).strict();

export const PaperPositionSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  symbol: z.string().min(1),
  quantity: DecimalStringSchema,
  averageEntryUsd: DecimalStringSchema,
  markPriceUsd: DecimalStringSchema,
  peakMarkPriceUsd: DecimalStringSchema,
  instrumentType: z.literal("modeled_option"),
  optionType: z.literal("put"),
  strikeUsd: DecimalStringSchema,
  expiryAt: IsoDateTimeSchema,
  impliedVolatility: DecimalStringSchema,
  modelName: z.literal("black_scholes_european_put"),
  premiumSource: z.literal("modeled"),
  modelInputs: z.record(z.string(), z.unknown()),
  openedAt: IsoDateTimeSchema,
  closedAt: IsoDateTimeSchema.nullable(),
  realizedPnlUsd: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  unrealizedPnlUsd: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  status: z.enum(["open", "closed"]),
  updatedAt: IsoDateTimeSchema,
}).strict();

export const PaperOrderSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  decisionId: z.string().min(1),
  tickId: z.string().min(1),
  symbol: z.string().min(1),
  instrumentType: z.literal("modeled_option"),
  optionType: z.literal("put"),
  strikeUsd: DecimalStringSchema,
  expiryAt: IsoDateTimeSchema,
  impliedVolatility: DecimalStringSchema,
  modelPremiumUsd: DecimalStringSchema,
  modelName: z.literal("black_scholes_european_put"),
  premiumSource: z.literal("modeled"),
  modelInputs: z.record(z.string(), z.unknown()),
  side: z.enum(["buy", "sell"]),
  quantity: DecimalStringSchema,
  priceUsd: DecimalStringSchema,
  feeUsd: DecimalStringSchema,
  slippageBps: z.number().nonnegative(),
  status: z.enum(["filled", "cancelled", "rejected"]),
  createdAt: IsoDateTimeSchema,
  executionMode: z.literal("PAPER"),
}).strict();

export const PaperTickResponseSchema = z.object({
  decision: AgentDecisionSchema,
  executionMode: z.literal("PAPER"),
  orderCount: z.number().int().nonnegative(),
  idempotentReplay: z.boolean(),
}).strict();

export const TapeResponseSchema = z.object({
  decisions: z.array(AgentDecisionSchema),
  orders: z.array(PaperOrderSchema).default([]),
  executionMode: z.literal("PAPER"),
}).strict();

export const PaperPositionsResponseSchema = z.object({
  positions: z.array(PaperPositionSchema),
  executionMode: z.literal("PAPER"),
}).strict();

export const PublicAgentsResponseSchema = z.object({ agents: z.array(AgentSchema) }).strict();
export const PublicTapeResponseSchema = z.object({ decisions: z.array(AgentDecisionSchema), orders: z.array(PaperOrderSchema).default([]), executionMode: z.literal("PAPER") }).strict();
export const PublicClaimSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["verified", "limited", "preview", "unavailable", "disabled"]),
  statement: z.string().min(1),
  evidencePath: z.string().startsWith("/"),
}).strict();
export const PublicVerificationSchema = z.object({
  v4ClaimLevel: z.literal("L0"),
  liveTradingEnabled: z.literal(false),
  claims: z.array(PublicClaimSchema),
}).strict();

const SignedPercentageSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);

export const BacktestBenchmarksSchema = z.object({
  window: z.object({
    startAt: IsoDateTimeSchema,
    endAt: IsoDateTimeSchema,
    decisionSamples: z.number().int().positive(),
  }).strict(),
  underlying: z.object({
    symbol: z.string().regex(/^[A-Z0-9.]{1,16}$/),
    startingValueUsd: DecimalStringSchema,
    endingValueUsd: DecimalStringSchema,
    returnPct: SignedPercentageSchema,
    method: z.literal("buy_and_hold_price_only"),
    dividendsIncluded: z.literal(false),
    feesIncluded: z.literal(false),
  }).strict(),
  cash: z.object({
    startingValueUsd: DecimalStringSchema,
    endingValueUsd: DecimalStringSchema,
    returnPct: SignedPercentageSchema,
    denomination: z.literal("USD"),
    method: z.literal("flat_no_yield"),
    usdGPricePath: z.literal("not_modeled"),
  }).strict(),
  vsHoldingPct: SignedPercentageSchema,
  vsCashPct: SignedPercentageSchema,
}).strict();

export const BacktestMetricsSchema = z.object({
  totalReturnPct: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  maxDrawdownPct: z.string().regex(/^\d+(?:\.\d+)?$/),
  endingCashUsd: DecimalStringSchema,
  benchmarks: BacktestBenchmarksSchema.optional(),
}).strict();

export const BacktestRunSchema = z.object({
  id: z.string().min(1),
  recipeHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  dataSource: z.string().min(1),
  startAt: IsoDateTimeSchema,
  endAt: IsoDateTimeSchema,
  sampleCount: z.number().int().nonnegative(),
  entryOrderCount: z.number().int().nonnegative().optional(),
  exitOrderCount: z.number().int().nonnegative().optional(),
  hourlyCoverageComplete: z.boolean(),
  premiumSource: z.enum(["recorded", "modeled", "unavailable"]),
  pricingMethod: z.enum(["recorded", "modeled", "unavailable"]),
  status: z.enum(["complete", "insufficient_data", "failed"]),
  metrics: BacktestMetricsSchema.nullable(),
  historyDataHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  historyProvenance: z.record(z.string(), z.unknown()).optional(),
  pricingAssumptions: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().min(1),
  createdAt: IsoDateTimeSchema,
}).strict();

export const BacktestCoverageSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9.]{1,16}$/),
  availableSamples: z.number().int().nonnegative(),
  requiredSamples: z.number().int().positive(),
  startAt: IsoDateTimeSchema.nullable(),
  endAt: IsoDateTimeSchema.nullable(),
  consecutiveHours: z.number().int().nonnegative(),
  ready: z.boolean(),
  dataSource: z.string().optional(),
  tokenAddress: EvmAddressSchema.nullable().optional(),
  multiplierStatus: z.enum(["stable_verified", "action_in_window", "unverified"]).optional(),
  fillApplied: z.boolean().optional(),
  reason: z.string().min(1),
}).strict();

export const MarketHistoryCollectionSchema = z.object({
  requested: z.number().int().nonnegative(),
  stored: z.number().int().nonnegative(),
  alreadyRecorded: z.number().int().nonnegative(),
  unavailableSymbols: z.array(z.string()),
}).strict();

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type AuthenticatedWalletUser = z.infer<typeof AuthenticatedWalletUserSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
export type MarketCandle = z.infer<typeof MarketCandleSchema>;
export type MarketHistoryCoverage = z.infer<typeof MarketHistoryCoverageSchema>;
export type MarketAsset = z.infer<typeof MarketAssetSchema>;
export type HookStage = z.infer<typeof HookStageSchema>;
export type HookDefinition = z.infer<typeof HookDefinitionSchema>;
export type HookResult = z.infer<typeof HookResultSchema>;
export type HookCatalogResponse = z.infer<typeof HookCatalogResponseSchema>;
export type RecipeValidationIssue = z.infer<typeof RecipeValidationIssueSchema>;
export type RecipeValidationResult = z.infer<typeof RecipeValidationResultSchema>;
export type HouseAgentTemplateId = z.infer<typeof HouseAgentTemplateIdSchema>;
export type HouseAgentTemplate = z.infer<typeof HouseAgentTemplateSchema>;
export type HouseAgentTemplateCatalogResponse = z.infer<typeof HouseAgentTemplateCatalogResponseSchema>;
export type RecipeV1 = z.infer<typeof RecipeV1Schema>;
export type Agent = z.infer<typeof AgentSchema>;
export type AgentDetail = z.infer<typeof AgentDetailSchema>;
export type AgentListResponse = z.infer<typeof AgentListResponseSchema>;
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export type PaperPosition = z.infer<typeof PaperPositionSchema>;
export type PaperOrder = z.infer<typeof PaperOrderSchema>;
export type PaperTickResponse = z.infer<typeof PaperTickResponseSchema>;
export type TapeResponse = z.infer<typeof TapeResponseSchema>;
export type PaperPositionsResponse = z.infer<typeof PaperPositionsResponseSchema>;
export type PublicAgentsResponse = z.infer<typeof PublicAgentsResponseSchema>;
export type PublicTapeResponse = z.infer<typeof PublicTapeResponseSchema>;
export type PublicClaim = z.infer<typeof PublicClaimSchema>;
export type PublicVerification = z.infer<typeof PublicVerificationSchema>;
export type BacktestRun = z.infer<typeof BacktestRunSchema>;
export type BacktestMetrics = z.infer<typeof BacktestMetricsSchema>;
export type BacktestBenchmarks = z.infer<typeof BacktestBenchmarksSchema>;
export type BacktestCoverage = z.infer<typeof BacktestCoverageSchema>;
export type MarketHistoryCollection = z.infer<typeof MarketHistoryCollectionSchema>;
