import { relations } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { BacktestMetrics, HookResult, RecipeV1, MarketCandle } from "../lib/domain/contracts";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  address: varchar("address", { length: 42 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authChallenges = pgTable("auth_challenges", {
  nonce: varchar("nonce", { length: 64 }).primaryKey(),
  address: varchar("address", { length: 42 }).notNull(),
  origin: text("origin").notNull(),
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("auth_challenges_address_idx").on(table.address, table.createdAt)]);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("sessions_user_expires_idx").on(table.userId, table.expiresAt),
]);

export const backtestRuns = pgTable("backtest_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  recipe: jsonb("recipe").$type<RecipeV1>().notNull(),
  recipeHash: varchar("recipe_hash", { length: 71 }).notNull(),
  dataSource: varchar("data_source", { length: 64 }).notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  sampleCount: integer("sample_count").notNull(),
  entryOrderCount: integer("entry_order_count").notNull().default(0),
  exitOrderCount: integer("exit_order_count").notNull().default(0),
  hourlyCoverageComplete: boolean("hourly_coverage_complete").notNull(),
  premiumSource: varchar("premium_source", { length: 16 }).notNull(),
  pricingMethod: varchar("pricing_method", { length: 16 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  metrics: jsonb("metrics").$type<BacktestMetrics | null>(),
  historyDataHash: varchar("history_data_hash", { length: 71 }),
  historyProvenance: jsonb("history_provenance").$type<Record<string, unknown>>(),
  historySnapshot: jsonb("history_snapshot").$type<MarketCandle[]>(),
  pricingAssumptions: jsonb("pricing_assumptions").$type<Record<string, unknown>>(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [index("backtest_runs_owner_created_idx").on(table.ownerId, table.createdAt)]);

export const agents = pgTable("agents", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  templateId: varchar("template_id", { length: 32 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  recipe: jsonb("recipe").$type<RecipeV1>().notNull(),
  recipeHash: varchar("recipe_hash", { length: 71 }).notNull(),
  backtestRunId: uuid("backtest_run_id").references(() => backtestRuns.id, { onDelete: "restrict" }),
  /** `house` marks an OPTRA-owned House Agent that runs in public, owned by the reserved OPTRA house user. */
  kind: varchar("kind", { length: 16 }).notNull().default("user"),
  /** `public` agents (House Agents only) expose their Decision Tape, positions and paper account without a session. */
  visibility: varchar("visibility", { length: 16 }).notNull().default("private"),
  houseKey: varchar("house_key", { length: 48 }),
  launchedAt: timestamp("launched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agents_owner_status_created_idx").on(table.ownerId, table.status, table.createdAt),
  index("agents_visibility_status_idx").on(table.visibility, table.status),
  uniqueIndex("agents_house_recipe_idx").on(table.houseKey, table.recipeHash).where(sql`${table.kind} = 'house'`),
]);

export const marketSnapshots = pgTable("market_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  symbol: varchar("symbol", { length: 16 }).notNull(),
  source: varchar("source", { length: 64 }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  underlyingBidUsd: varchar("underlying_bid_usd", { length: 64 }).notNull(),
  underlyingAskUsd: varchar("underlying_ask_usd", { length: 64 }).notNull(),
  currentMultiplier: varchar("current_multiplier", { length: 64 }).notNull(),
  tokenBidUsd: varchar("token_bid_usd", { length: 64 }).notNull(),
  tokenAskUsd: varchar("token_ask_usd", { length: 64 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  stale: boolean("stale").notNull(),
  tradingHalt: boolean("trading_halt").notNull(),
  pricingMethod: varchar("pricing_method", { length: 16 }).notNull(),
}, (table) => [
  uniqueIndex("market_snapshots_symbol_observed_idx").on(table.symbol, table.observedAt),
]);

export const hourlyMarketSamples = pgTable("hourly_market_samples", {
  id: uuid("id").defaultRandom().primaryKey(),
  symbol: varchar("symbol", { length: 16 }).notNull(),
  hourBucket: timestamp("hour_bucket", { withTimezone: true }).notNull(),
  snapshotId: uuid("snapshot_id").notNull().references(() => marketSnapshots.id, { onDelete: "restrict" }),
}, (table) => [
  uniqueIndex("hourly_market_samples_symbol_hour_idx").on(table.symbol, table.hourBucket),
]);

export const paperDecisions = pgTable("paper_decisions", {
  id: varchar("id", { length: 256 }).primaryKey(),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  tickId: varchar("tick_id", { length: 128 }).notNull(),
  action: varchar("action", { length: 16 }).notNull(),
  reason: text("reason").notNull(),
  hookResults: jsonb("hook_results").$type<HookResult[]>().notNull(),
  marketContext: jsonb("market_context").$type<Record<string, unknown>>(),
  snapshotId: uuid("snapshot_id").references(() => marketSnapshots.id, { onDelete: "set null" }),
  snapshotSource: varchar("snapshot_source", { length: 64 }).notNull(),
  recipeHash: varchar("recipe_hash", { length: 71 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("paper_decisions_agent_tick_idx").on(table.agentId, table.tickId),
  index("paper_decisions_agent_created_idx").on(table.agentId, table.createdAt),
]);

export const paperOrders = pgTable("paper_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  decisionId: varchar("decision_id", { length: 256 }).notNull().references(() => paperDecisions.id, { onDelete: "restrict" }),
  orderSeq: integer("order_seq").notNull().default(0),
  positionId: uuid("position_id"),
  tickId: varchar("tick_id", { length: 128 }).notNull(),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  instrumentType: varchar("instrument_type", { length: 32 }).notNull().default("modeled_option"),
  optionType: varchar("option_type", { length: 8 }).notNull().default("put"),
  strikeUsd: varchar("strike_usd", { length: 64 }).notNull().default("0"),
  expiryAt: timestamp("expiry_at", { withTimezone: true }).notNull().defaultNow(),
  impliedVolatility: varchar("implied_volatility", { length: 64 }).notNull().default("0"),
  modelPremiumUsd: varchar("model_premium_usd", { length: 64 }).notNull().default("0"),
  modelName: varchar("model_name", { length: 64 }).notNull().default("black_scholes_european_put"),
  premiumSource: varchar("premium_source", { length: 16 }).notNull().default("modeled"),
  modelInputs: jsonb("model_inputs").$type<Record<string, unknown>>().notNull().default({}),
  purpose: varchar("purpose", { length: 32 }),
  legRole: varchar("leg_role", { length: 16 }),
  side: varchar("side", { length: 8 }).notNull(),
  quantity: varchar("quantity", { length: 64 }).notNull(),
  priceUsd: varchar("price_usd", { length: 64 }).notNull(),
  feeUsd: varchar("fee_usd", { length: 64 }).notNull(),
  slippageBps: integer("slippage_bps").notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  executionMode: varchar("execution_mode", { length: 8 }).notNull().default("PAPER"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("paper_orders_agent_tick_seq_idx").on(table.agentId, table.tickId, table.orderSeq)]);

export const paperPositions = pgTable("paper_positions", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  symbol: varchar("symbol", { length: 32 }).notNull(),
  instrumentType: varchar("instrument_type", { length: 32 }).notNull().default("modeled_option"),
  optionType: varchar("option_type", { length: 8 }).notNull().default("put"),
  strikeUsd: varchar("strike_usd", { length: 64 }).notNull().default("0"),
  expiryAt: timestamp("expiry_at", { withTimezone: true }).notNull().defaultNow(),
  impliedVolatility: varchar("implied_volatility", { length: 64 }).notNull().default("0"),
  modelName: varchar("model_name", { length: 64 }).notNull().default("black_scholes_european_put"),
  premiumSource: varchar("premium_source", { length: 16 }).notNull().default("modeled"),
  modelInputs: jsonb("model_inputs").$type<Record<string, unknown>>().notNull().default({}),
  peakMarkPriceUsd: varchar("peak_mark_price_usd", { length: 64 }).notNull().default("0"),
  /** `long` pays a modeled premium; `short` receives one. Rows from before the strategy engine are long puts. */
  side: varchar("side", { length: 8 }).notNull().default("long"),
  /** Virtual USDG reserved against a short put (strike × quantity). */
  collateralUsd: varchar("collateral_usd", { length: 64 }).notNull().default("0"),
  structureId: varchar("structure_id", { length: 160 }),
  legRole: varchar("leg_role", { length: 16 }),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  realizedPnlUsd: varchar("realized_pnl_usd", { length: 64 }).notNull().default("0"),
  quantity: varchar("quantity", { length: 64 }).notNull(),
  averageEntryUsd: varchar("average_entry_usd", { length: 64 }).notNull(),
  markPriceUsd: varchar("mark_price_usd", { length: 64 }).notNull(),
  unrealizedPnlUsd: varchar("unrealized_pnl_usd", { length: 64 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("paper_positions_agent_status_idx").on(table.agentId, table.status),
  // One open long single-leg position per agent (Protective Put). Short positions and straddle legs are limited by the engine.
  uniqueIndex("paper_positions_agent_open_idx").on(table.agentId).where(sql`${table.status} = 'open' and ${table.side} = 'long' and ${table.structureId} is null`),
]);

export const paperAccounts = pgTable("paper_accounts", {
  agentId: uuid("agent_id").primaryKey().references(() => agents.id, { onDelete: "cascade" }),
  initialCapitalUsd: varchar("initial_capital_usd", { length: 64 }).notNull(),
  cashUsd: varchar("cash_usd", { length: 64 }).notNull(),
  realizedPnlUsd: varchar("realized_pnl_usd", { length: 64 }).notNull().default("0"),
  peakEquityUsd: varchar("peak_equity_usd", { length: 64 }).notNull(),
  dailyStartEquityUsd: varchar("daily_start_equity_usd", { length: 64 }).notNull(),
  dailyStartDate: varchar("daily_start_date", { length: 10 }).notNull(),
  /** Strategy-engine counters and reference-share state; `{}` for Protective Put accounts. */
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const callputOrders = pgTable("callput_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientIntentId: varchar("client_intent_id", { length: 128 }).notNull(),
  account: varchar("account", { length: 42 }).notNull(),
  chainId: integer("chain_id").notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  intent: jsonb("intent").$type<Record<string, unknown>>().notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("callput_orders_owner_intent_idx").on(table.ownerId, table.clientIntentId),
  index("callput_orders_owner_created_idx").on(table.ownerId, table.createdAt),
]);

export const callputOrderEvents = pgTable("callput_order_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => callputOrders.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientEventId: varchar("client_event_id", { length: 36 }).notNull(),
  referenceKind: varchar("reference_kind", { length: 24 }).notNull(),
  transactionKind: varchar("transaction_kind", { length: 32 }).notNull(),
  transactionHash: varchar("transaction_hash", { length: 66 }).notNull(),
  requestKey: varchar("request_key", { length: 66 }),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("callput_order_events_owner_event_idx").on(table.ownerId, table.clientEventId),
  index("callput_order_events_order_created_idx").on(table.orderId, table.createdAt),
]);

/** Durable emergency stop per owner. A missing row means stopped; only the Live Agent store can clear it. */
export const liveAgentControls = pgTable("live_agent_controls", {
  ownerId: uuid("owner_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  stopped: boolean("stopped").notNull().default(true),
  stopReason: varchar("stop_reason", { length: 200 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Owner-specific CallPut Live Agent grant. Created `proposed`; `active` requires every autonomy evidence reference. */
export const liveAgentGrants = pgTable("live_agent_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentId: varchar("agent_id", { length: 64 }).notNull(),
  tradingAddress: varchar("trading_address", { length: 42 }).notNull(),
  route: varchar("route", { length: 24 }).notNull(),
  policy: jsonb("policy").$type<Record<string, unknown>>().notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  status: varchar("status", { length: 16 }).notNull().default("proposed"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("live_agent_grants_owner_status_idx").on(table.ownerId, table.status),
  uniqueIndex("live_agent_grants_one_active_idx").on(table.ownerId, table.agentId).where(sql`${table.status} = 'active'`),
]);

/** Every automated order attempt, keyed by a deterministic idempotency key so a decision can never submit twice. */
export const liveAgentRequests = pgTable("live_agent_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  grantId: uuid("grant_id").notNull().references(() => liveAgentGrants.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
  state: varchar("state", { length: 16 }).notNull().default("reserved"),
  collateralRaw: varchar("collateral_raw", { length: 78 }).notNull(),
  transactionHash: varchar("transaction_hash", { length: 66 }),
  requestKey: varchar("request_key", { length: 66 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("live_agent_requests_owner_key_idx").on(table.ownerId, table.idempotencyKey),
  index("live_agent_requests_owner_state_idx").on(table.ownerId, table.state),
]);

/** One single-flight scheduler lease per owner; expiry makes a crashed holder recoverable. */
export const liveAgentLeases = pgTable("live_agent_leases", {
  ownerId: uuid("owner_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  holder: varchar("holder", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({ sessions: many(sessions) }));
export const sessionsRelations = relations(sessions, ({ one }) => ({ user: one(users, { fields: [sessions.userId], references: [users.id] }) }));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  owner: one(users, { fields: [agents.ownerId], references: [users.id] }),
  backtest: one(backtestRuns, { fields: [agents.backtestRunId], references: [backtestRuns.id] }),
  decisions: many(paperDecisions),
  orders: many(paperOrders),
  positions: many(paperPositions),
  paperAccount: one(paperAccounts, { fields: [agents.id], references: [paperAccounts.agentId] }),
}));
export const paperDecisionsRelations = relations(paperDecisions, ({ one }) => ({
  agent: one(agents, { fields: [paperDecisions.agentId], references: [agents.id] }),
  snapshot: one(marketSnapshots, { fields: [paperDecisions.snapshotId], references: [marketSnapshots.id] }),
}));

export const backtestRunsRelations = relations(backtestRuns, ({ one, many }) => ({
  owner: one(users, { fields: [backtestRuns.ownerId], references: [users.id] }),
  agents: many(agents),
}));
export const hourlyMarketSamplesRelations = relations(hourlyMarketSamples, ({ one }) => ({
  snapshot: one(marketSnapshots, { fields: [hourlyMarketSamples.snapshotId], references: [marketSnapshots.id] }),
}));

export const schema = { users, authChallenges, sessions, backtestRuns, agents, marketSnapshots, hourlyMarketSamples, paperDecisions, paperOrders, paperPositions, paperAccounts, callputOrders, callputOrderEvents, liveAgentControls, liveAgentGrants, liveAgentRequests, liveAgentLeases };

/** G7: the owner's explicit options-risk acknowledgement. One row per owner, replaced when the wording version changes. */
export const liveRiskAcknowledgements = pgTable("live_risk_acknowledgements", {
  ownerId: uuid("owner_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  version: varchar("version", { length: 32 }).notNull(),
  statementIds: jsonb("statement_ids").$type<string[]>().notNull(),
  /** Country the edge reported when the owner acknowledged, or null when it could not be determined. */
  country: varchar("country", { length: 2 }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Wave A: Global Risk Desk economic controls. Overrides all individual agent economic mandates. */
export const economicGlobalControls = pgTable("economic_global_controls", {
  id: varchar("id", { length: 32 }).primaryKey(),
  pauseAllAutonomousAgents: boolean("pause_all_autonomous_agents").notNull().default(false),
  pauseNewEntries: boolean("pause_new_entries").notNull().default(false),
  pauseMachineServiceSpending: boolean("pause_machine_service_spending").notNull().default(false),
  disableX402Globally: boolean("disable_x402_globally").notNull().default(false),
  emergencyDenyAllMachinePayments: boolean("emergency_deny_all_machine_payments").notNull().default(false),
  disabledProviders: jsonb("disabled_providers").$type<string[]>().notNull().default([]),
  disabledCategories: jsonb("disabled_categories").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Wave A (T4): Centrally auditable OPTRA Service Provider Registry for x402 machine services. */
export const serviceProviders = pgTable("service_providers", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  endpoint: text("endpoint").notNull(),
  serviceCategory: varchar("service_category", { length: 32 }).notNull(),
  paymentProtocol: varchar("payment_protocol", { length: 16 }).notNull().default("X402"),
  acceptedAssets: jsonb("accepted_assets").$type<string[]>().notNull(),
  network: varchar("network", { length: 32 }).notNull(),
  payTo: varchar("pay_to", { length: 42 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("ACTIVE"),
  trustTier: varchar("trust_tier", { length: 24 }).notNull().default("OPTRA_VERIFIED"),
  ownership: varchar("ownership", { length: 24 }).notNull().default("OPTRA_OWNED"),
  expectedResponseSchema: varchar("expected_response_schema", { length: 64 }),
  maxKnownPriceAtomic: varchar("max_known_price_atomic", { length: 78 }),
  healthCheckUrl: text("health_check_url"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Wave A (T1): Isolated Agent Economic Account & Service Budget (never shared with Trading Capital). */
export const agentEconomicAccounts = pgTable("agent_economic_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id").notNull().unique().references(() => agents.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  serviceBalanceAtomic: varchar("service_balance_atomic", { length: 78 }).notNull().default("0"),
  totalFundedAtomic: varchar("total_funded_atomic", { length: 78 }).notNull().default("0"),
  totalSpentAtomic: varchar("total_spent_atomic", { length: 78 }).notNull().default("0"),
  spentTodayAtomic: varchar("spent_today_atomic", { length: 78 }).notNull().default("0"),
  spendDayUtc: varchar("spend_day_utc", { length: 10 }).notNull(),
  requestsThisHour: integer("requests_this_hour").notNull().default(0),
  hourWindowStart: varchar("hour_window_start", { length: 32 }).notNull(),
  mandate: jsonb("mandate").$type<Record<string, unknown>>().notNull(),
  mandateHash: varchar("mandate_hash", { length: 71 }).notNull(),
  mandateVersion: integer("mandate_version").notNull().default(1),
  machineSpendingStatus: varchar("machine_spending_status", { length: 16 }).notNull().default("PAUSED"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agent_economic_accounts_owner_idx").on(table.ownerId),
]);

/** Wave A (T1): Immutable audit log for every Service Budget or Economic Mandate mutation. */
export const agentEconomicBudgetEvents = pgTable("agent_economic_budget_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 32 }).notNull(),
  amountAtomic: varchar("amount_atomic", { length: 78 }).notNull().default("0"),
  balanceAfterAtomic: varchar("balance_after_atomic", { length: 78 }).notNull(),
  mandateHash: varchar("mandate_hash", { length: 71 }).notNull(),
  actor: varchar("actor", { length: 64 }).notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agent_economic_budget_events_agent_idx").on(table.agentId, table.createdAt),
]);

/** Wave A (T3/T10): Persistent x402 payment & reconciliation ledger with duplicate/replay protection. */
export const x402PaymentRecords = pgTable("x402_payment_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  decisionId: varchar("decision_id", { length: 256 }).notNull(),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  providerId: varchar("provider_id", { length: 64 }).notNull(),
  serviceCategory: varchar("service_category", { length: 32 }).notNull(),
  requestNonce: varchar("request_nonce", { length: 128 }).notNull(),
  requestHash: varchar("request_hash", { length: 71 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
  amountAtomic: varchar("amount_atomic", { length: 78 }).notNull(),
  asset: varchar("asset", { length: 64 }).notNull(),
  network: varchar("network", { length: 32 }).notNull(),
  paymentMode: varchar("payment_mode", { length: 16 }).notNull().default("EXACT"),
  settlementMode: varchar("settlement_mode", { length: 24 }).notNull().default("PAPER_REHEARSAL"),
  status: varchar("status", { length: 24 }).notNull(),
  reasonCode: varchar("reason_code", { length: 64 }).notNull(),
  paymentChallenge: jsonb("payment_challenge").$type<Record<string, unknown>>(),
  paymentReference: varchar("payment_reference", { length: 128 }),
  settlementReference: varchar("settlement_reference", { length: 128 }),
  txHash: varchar("tx_hash", { length: 66 }),
  responseHash: varchar("response_hash", { length: 71 }),
  validationStatus: varchar("validation_status", { length: 16 }).notNull().default("PENDING"),
  validationReason: text("validation_reason"),
  economicMandateHash: varchar("economic_mandate_hash", { length: 71 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("x402_payment_records_agent_idemp_idx").on(table.agentId, table.idempotencyKey),
  uniqueIndex("x402_payment_records_agent_nonce_idx").on(table.agentId, table.requestNonce),
  index("x402_payment_records_agent_created_idx").on(table.agentId, table.createdAt),
  index("x402_payment_records_decision_idx").on(table.decisionId),
]);

/** Wave A (T7): First-class Economic Trace events for OPTRA Decision Tape. */
export const x402TapeEvents = pgTable("x402_tape_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  decisionId: varchar("decision_id", { length: 256 }).notNull(),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 40 }).notNull(),
  providerId: varchar("provider_id", { length: 64 }),
  serviceCategory: varchar("service_category", { length: 32 }),
  amountAtomic: varchar("amount_atomic", { length: 78 }),
  asset: varchar("asset", { length: 64 }),
  requestHash: varchar("request_hash", { length: 71 }),
  responseHash: varchar("response_hash", { length: 71 }),
  paymentReference: varchar("payment_reference", { length: 128 }),
  txHash: varchar("tx_hash", { length: 66 }),
  economicMandateHash: varchar("economic_mandate_hash", { length: 71 }).notNull(),
  reason: text("reason").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("x402_tape_events_agent_created_idx").on(table.agentId, table.createdAt),
  index("x402_tape_events_decision_idx").on(table.decisionId),
]);
