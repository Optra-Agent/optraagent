import { and, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import {
  agentEconomicAccounts,
  agentEconomicBudgetEvents,
  agents,
  economicGlobalControls,
  serviceProviders,
  x402PaymentRecords,
  x402TapeEvents,
} from "../../db/schema";
import { addAtomic, cmpAtomic, parseUsdgToAtomic, subAtomic } from "./atomic";
import { evaluateEconomicPolicy } from "./policy-engine";
import { DEFAULT_SERVICE_PROVIDERS } from "./provider-registry";
import {
  DEFAULT_ECONOMIC_MANDATE,
  DEFAULT_GLOBAL_CONTROLS,
  DEFAULT_HOUSE_ECONOMIC_MANDATE,
  EconomicMandateSchema,
  ServiceProviderSchema,
  canonicalEconomicMandateHash,
} from "./types";
import type {
  EconomicAuthorizationDecision,
  EconomicGlobalControls,
  EconomicMandate,
  MachineServiceRequest,
  PaymentMode,
  ServiceCategory,
  ServiceProvider,
  SettlementMode,
  SpendState,
  X402PaymentRecordView,
  X402TapeEventRecord,
  X402TapeEventType,
} from "./types";

export type AgentEconomicAccountView = {
  id: string;
  agentId: string;
  ownerId: string;
  serviceBalanceAtomic: string;
  totalFundedAtomic: string;
  totalSpentAtomic: string;
  spentTodayAtomic: string;
  remainingTodayAtomic: string;
  spendDayUtc: string;
  requestsThisHour: number;
  hourWindowStart: string;
  mandate: EconomicMandate;
  mandateHash: string;
  mandateVersion: number;
  machineSpendingStatus: "ACTIVE" | "PAUSED" | "EXHAUSTED";
  updatedAt: string;
};

function toAccountView(row: typeof agentEconomicAccounts.$inferSelect, now = new Date()): AgentEconomicAccountView {
  const mandate = EconomicMandateSchema.parse(row.mandate);
  const currentDay = now.toISOString().slice(0, 10);
  const spentToday = row.spendDayUtc === currentDay ? row.spentTodayAtomic : "0";
  const remainingDaily =
    cmpAtomic(mandate.dailyServiceBudgetAtomic, spentToday) >= 0
      ? subAtomic(mandate.dailyServiceBudgetAtomic, spentToday)
      : "0";
  const remainingTodayAtomic =
    cmpAtomic(remainingDaily, row.serviceBalanceAtomic) <= 0 ? remainingDaily : row.serviceBalanceAtomic;

  return {
    id: row.id,
    agentId: row.agentId,
    ownerId: row.ownerId,
    serviceBalanceAtomic: row.serviceBalanceAtomic,
    totalFundedAtomic: row.totalFundedAtomic,
    totalSpentAtomic: row.totalSpentAtomic,
    spentTodayAtomic: spentToday,
    remainingTodayAtomic,
    spendDayUtc: currentDay,
    requestsThisHour: row.hourWindowStart.slice(0, 13) === now.toISOString().slice(0, 13) ? row.requestsThisHour : 0,
    hourWindowStart: row.hourWindowStart,
    mandate,
    mandateHash: row.mandateHash,
    mandateVersion: row.mandateVersion,
    machineSpendingStatus: row.machineSpendingStatus as AgentEconomicAccountView["machineSpendingStatus"],
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toProviderView(row: typeof serviceProviders.$inferSelect): ServiceProvider {
  return ServiceProviderSchema.parse({
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    serviceCategory: row.serviceCategory,
    paymentProtocol: row.paymentProtocol,
    acceptedAssets: row.acceptedAssets,
    network: row.network,
    payTo: row.payTo,
    status: row.status,
    trustTier: row.trustTier,
    ownership: row.ownership,
    ...(row.expectedResponseSchema ? { expectedResponseSchema: row.expectedResponseSchema } : {}),
    ...(row.maxKnownPriceAtomic ? { maxKnownPriceAtomic: row.maxKnownPriceAtomic } : {}),
    ...(row.healthCheckUrl ? { healthCheckUrl: row.healthCheckUrl } : {}),
    metadata: row.metadata ?? {},
  });
}

function toPaymentView(row: typeof x402PaymentRecords.$inferSelect): X402PaymentRecordView {
  return {
    id: row.id,
    decisionId: row.decisionId,
    agentId: row.agentId,
    providerId: row.providerId,
    serviceCategory: row.serviceCategory,
    requestNonce: row.requestNonce,
    requestHash: row.requestHash,
    idempotencyKey: row.idempotencyKey,
    amountAtomic: row.amountAtomic,
    asset: row.asset,
    network: row.network,
    paymentMode: row.paymentMode as PaymentMode,
    settlementMode: row.settlementMode as SettlementMode,
    status: row.status as X402PaymentRecordView["status"],
    reasonCode: row.reasonCode,
    paymentReference: row.paymentReference,
    settlementReference: row.settlementReference,
    txHash: row.txHash,
    responseHash: row.responseHash,
    validationStatus: row.validationStatus as X402PaymentRecordView["validationStatus"],
    validationReason: row.validationReason,
    economicMandateHash: row.economicMandateHash,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTapeEventView(row: typeof x402TapeEvents.$inferSelect): X402TapeEventRecord {
  return {
    id: row.id,
    decisionId: row.decisionId,
    agentId: row.agentId,
    eventType: row.eventType as X402TapeEventType,
    providerId: row.providerId,
    serviceCategory: row.serviceCategory,
    amountAtomic: row.amountAtomic,
    asset: row.asset,
    requestHash: row.requestHash,
    responseHash: row.responseHash,
    paymentReference: row.paymentReference,
    txHash: row.txHash,
    economicMandateHash: row.economicMandateHash,
    reason: row.reason,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleEconomicRepository {
  constructor(private readonly db: AppDatabase) {}

  async ensureDefaultProviders(now = new Date()): Promise<void> {
    for (const provider of DEFAULT_SERVICE_PROVIDERS) {
      await this.db
        .insert(serviceProviders)
        .values({
          id: provider.id,
          name: provider.name,
          endpoint: provider.endpoint,
          serviceCategory: provider.serviceCategory,
          paymentProtocol: provider.paymentProtocol,
          acceptedAssets: provider.acceptedAssets,
          network: provider.network,
          payTo: provider.payTo,
          status: provider.status,
          trustTier: provider.trustTier,
          ownership: provider.ownership,
          expectedResponseSchema: provider.expectedResponseSchema ?? null,
          maxKnownPriceAtomic: provider.maxKnownPriceAtomic ?? null,
          healthCheckUrl: provider.healthCheckUrl ?? null,
          metadata: provider.metadata,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: serviceProviders.id });
    }
  }

  async listServiceProviders(): Promise<ServiceProvider[]> {
    await this.ensureDefaultProviders();
    const rows = await this.db.select().from(serviceProviders);
    return rows.map(toProviderView);
  }

  async getServiceProvider(providerId: string): Promise<ServiceProvider | null> {
    await this.ensureDefaultProviders();
    const [row] = await this.db.select().from(serviceProviders).where(eq(serviceProviders.id, providerId)).limit(1);
    return row ? toProviderView(row) : null;
  }

  async getGlobalControls(): Promise<EconomicGlobalControls> {
    const [row] = await this.db.select().from(economicGlobalControls).where(eq(economicGlobalControls.id, "global")).limit(1);
    if (!row) return { ...DEFAULT_GLOBAL_CONTROLS };
    return {
      pauseAllAutonomousAgents: row.pauseAllAutonomousAgents,
      pauseNewEntries: row.pauseNewEntries,
      pauseMachineServiceSpending: row.pauseMachineServiceSpending,
      disableX402Globally: row.disableX402Globally,
      emergencyDenyAllMachinePayments: row.emergencyDenyAllMachinePayments,
      disabledProviders: row.disabledProviders ?? [],
      disabledCategories: (row.disabledCategories ?? []) as ServiceCategory[],
    };
  }

  async updateGlobalControls(controls: Partial<EconomicGlobalControls>, now = new Date()): Promise<EconomicGlobalControls> {
    const current = await this.getGlobalControls();
    const next: EconomicGlobalControls = { ...current, ...controls };
    await this.db
      .insert(economicGlobalControls)
      .values({
        id: "global",
        pauseAllAutonomousAgents: next.pauseAllAutonomousAgents,
        pauseNewEntries: next.pauseNewEntries,
        pauseMachineServiceSpending: next.pauseMachineServiceSpending,
        disableX402Globally: next.disableX402Globally,
        emergencyDenyAllMachinePayments: next.emergencyDenyAllMachinePayments,
        disabledProviders: next.disabledProviders,
        disabledCategories: next.disabledCategories,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: economicGlobalControls.id,
        set: {
          pauseAllAutonomousAgents: next.pauseAllAutonomousAgents,
          pauseNewEntries: next.pauseNewEntries,
          pauseMachineServiceSpending: next.pauseMachineServiceSpending,
          disableX402Globally: next.disableX402Globally,
          emergencyDenyAllMachinePayments: next.emergencyDenyAllMachinePayments,
          disabledProviders: next.disabledProviders,
          disabledCategories: next.disabledCategories,
          updatedAt: now,
        },
      });
    return next;
  }

  async getOrCreateEconomicAccount(
    agentId: string,
    ownerId: string,
    options?: { isHouseAgent?: boolean; initialMandate?: EconomicMandate; initialBalanceAtomic?: string; now?: Date },
  ): Promise<AgentEconomicAccountView> {
    const now = options?.now ?? new Date();
    const [existing] = await this.db
      .select()
      .from(agentEconomicAccounts)
      .where(eq(agentEconomicAccounts.agentId, agentId))
      .limit(1);
    if (existing) return toAccountView(existing, now);

    const mandate = options?.initialMandate
      ? EconomicMandateSchema.parse(options.initialMandate)
      : options?.isHouseAgent
        ? DEFAULT_HOUSE_ECONOMIC_MANDATE
        : DEFAULT_ECONOMIC_MANDATE;
    const mandateHash = canonicalEconomicMandateHash(mandate);
    const initialBalance = options?.initialBalanceAtomic ?? (options?.isHouseAgent ? parseUsdgToAtomic("2.00") : "0");
    const status = mandate.enabled ? (BigInt(initialBalance) > 0n ? "ACTIVE" : "EXHAUSTED") : "PAUSED";
    const day = now.toISOString().slice(0, 10);
    const hour = now.toISOString();

    await this.db
      .insert(agentEconomicAccounts)
      .values({
        agentId,
        ownerId,
        serviceBalanceAtomic: initialBalance,
        totalFundedAtomic: initialBalance,
        totalSpentAtomic: "0",
        spentTodayAtomic: "0",
        spendDayUtc: day,
        requestsThisHour: 0,
        hourWindowStart: hour,
        mandate,
        mandateHash,
        mandateVersion: 1,
        machineSpendingStatus: status,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: agentEconomicAccounts.agentId });

    const [created] = await this.db
      .select()
      .from(agentEconomicAccounts)
      .where(eq(agentEconomicAccounts.agentId, agentId))
      .limit(1);
    if (!created) throw new Error("Unable to initialize agent economic account.");

    await this.db.insert(agentEconomicBudgetEvents).values({
      agentId,
      ownerId,
      eventType: "ACCOUNT_INITIALIZED",
      amountAtomic: initialBalance,
      balanceAfterAtomic: created.serviceBalanceAtomic,
      mandateHash: created.mandateHash,
      actor: options?.isHouseAgent ? "optra-house-bootstrap" : ownerId,
      reason: options?.isHouseAgent ? "Initialized isolated House Agent Service Budget." : "Initialized isolated Custom Agent Economic Account.",
      createdAt: now,
    });

    return toAccountView(created, now);
  }

  async fundServiceBudget(
    ownerId: string,
    agentId: string,
    amountAtomic: string,
    reason: string,
    now = new Date(),
  ): Promise<AgentEconomicAccountView> {
    if (BigInt(amountAtomic) <= 0n) throw new Error("Funding amount must be positive.");
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(agentEconomicAccounts)
        .where(and(eq(agentEconomicAccounts.agentId, agentId), eq(agentEconomicAccounts.ownerId, ownerId)))
        .limit(1);
      if (!row) throw new Error("Agent economic account not found for owner.");

      const nextBalance = addAtomic(row.serviceBalanceAtomic, amountAtomic);
      const nextTotalFunded = addAtomic(row.totalFundedAtomic, amountAtomic);
      const mandate = EconomicMandateSchema.parse(row.mandate);
      const nextStatus = mandate.enabled && row.machineSpendingStatus === "EXHAUSTED" ? "ACTIVE" : row.machineSpendingStatus;

      const [updated] = await tx
        .update(agentEconomicAccounts)
        .set({
          serviceBalanceAtomic: nextBalance,
          totalFundedAtomic: nextTotalFunded,
          machineSpendingStatus: nextStatus,
          updatedAt: now,
        })
        .where(eq(agentEconomicAccounts.id, row.id))
        .returning();

      await tx.insert(agentEconomicBudgetEvents).values({
        agentId,
        ownerId,
        eventType: "SERVICE_BUDGET_FUNDED",
        amountAtomic,
        balanceAfterAtomic: nextBalance,
        mandateHash: row.mandateHash,
        actor: ownerId,
        reason,
        createdAt: now,
      });

      return toAccountView(updated!, now);
    });
  }

  async updateEconomicMandate(
    ownerId: string,
    agentId: string,
    mandateInput: EconomicMandate,
    reason: string,
    now = new Date(),
  ): Promise<AgentEconomicAccountView> {
    const mandate = EconomicMandateSchema.parse(mandateInput);
    const mandateHash = canonicalEconomicMandateHash(mandate);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(agentEconomicAccounts)
        .where(and(eq(agentEconomicAccounts.agentId, agentId), eq(agentEconomicAccounts.ownerId, ownerId)))
        .limit(1);
      if (!row) throw new Error("Agent economic account not found for owner.");

      const nextStatus = !mandate.enabled ? "PAUSED" : BigInt(row.serviceBalanceAtomic) > 0n ? "ACTIVE" : "EXHAUSTED";
      const [updated] = await tx
        .update(agentEconomicAccounts)
        .set({
          mandate,
          mandateHash,
          mandateVersion: row.mandateVersion + 1,
          machineSpendingStatus: nextStatus,
          updatedAt: now,
        })
        .where(eq(agentEconomicAccounts.id, row.id))
        .returning();

      await tx.insert(agentEconomicBudgetEvents).values({
        agentId,
        ownerId,
        eventType: "MANDATE_UPDATED",
        amountAtomic: "0",
        balanceAfterAtomic: row.serviceBalanceAtomic,
        mandateHash,
        actor: ownerId,
        reason,
        createdAt: now,
      });

      return toAccountView(updated!, now);
    });
  }

  async recordTapeEvent(event: {
    decisionId: string;
    agentId: string;
    eventType: X402TapeEventType;
    providerId?: string | null;
    serviceCategory?: string | null;
    amountAtomic?: string | null;
    asset?: string | null;
    requestHash?: string | null;
    responseHash?: string | null;
    paymentReference?: string | null;
    txHash?: string | null;
    economicMandateHash: string;
    reason: string;
    metadata?: Record<string, unknown>;
    now?: Date;
  }): Promise<void> {
    await this.db.insert(x402TapeEvents).values({
      decisionId: event.decisionId,
      agentId: event.agentId,
      eventType: event.eventType,
      providerId: event.providerId ?? null,
      serviceCategory: event.serviceCategory ?? null,
      amountAtomic: event.amountAtomic ?? null,
      asset: event.asset ?? null,
      requestHash: event.requestHash ?? null,
      responseHash: event.responseHash ?? null,
      paymentReference: event.paymentReference ?? null,
      txHash: event.txHash ?? null,
      economicMandateHash: event.economicMandateHash,
      reason: event.reason,
      metadata: event.metadata ?? {},
      createdAt: event.now ?? new Date(),
    });
  }

  async authorizePaymentRequest(input: {
    agentId: string;
    agentStatus: "draft" | "running" | "paused" | "stopped";
    request: MachineServiceRequest;
    requestHash: string;
    provider: ServiceProvider | null;
    paymentChallenge?: Record<string, unknown>;
    paymentMode?: PaymentMode;
    settlementMode?: SettlementMode;
    now?: Date;
  }): Promise<{
    decision: EconomicAuthorizationDecision;
    paymentRecord: X402PaymentRecordView;
    duplicate: boolean;
    mandateHash: string;
  }> {
    const now = input.now ?? new Date(input.request.createdAt);
    const currentDay = now.toISOString().slice(0, 10);
    const currentHour = now.toISOString();

    return this.db.transaction(async (tx) => {
      // Duplicate-payment & replay guard: return existing record if idempotencyKey already seen.
      const [existing] = await tx
        .select()
        .from(x402PaymentRecords)
        .where(
          and(
            eq(x402PaymentRecords.agentId, input.agentId),
            eq(x402PaymentRecords.idempotencyKey, input.request.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        const [acct] = await tx.select().from(agentEconomicAccounts).where(eq(agentEconomicAccounts.agentId, input.agentId)).limit(1);
        const mandate = acct ? EconomicMandateSchema.parse(acct.mandate) : DEFAULT_ECONOMIC_MANDATE;
        const remaining = acct && cmpAtomic(mandate.dailyServiceBudgetAtomic, acct.spentTodayAtomic) >= 0
          ? subAtomic(mandate.dailyServiceBudgetAtomic, acct.spentTodayAtomic)
          : "0";
        return {
          decision: {
            allowed: existing.status === "AUTHORIZED" || existing.status === "SETTLED" || existing.status === "RECONCILED",
            reasonCode: existing.reasonCode as EconomicAuthorizationDecision["reasonCode"],
            reason: "Idempotent replay of existing x402 payment record; duplicate charge prevented.",
            remainingDailyBudgetAtomic: remaining,
            remainingServiceBalanceAtomic: acct?.serviceBalanceAtomic ?? "0",
          },
          paymentRecord: toPaymentView(existing),
          duplicate: true,
          mandateHash: existing.economicMandateHash,
        };
      }

      const [accountRow] = await tx
        .select()
        .from(agentEconomicAccounts)
        .where(eq(agentEconomicAccounts.agentId, input.agentId))
        .limit(1);
      if (!accountRow) {
        throw new Error(`Economic account missing for agent ${input.agentId}.`);
      }

      const mandate = EconomicMandateSchema.parse(accountRow.mandate);
      const spendState: SpendState = {
        serviceBalanceAtomic: accountRow.serviceBalanceAtomic,
        spentTodayAtomic: accountRow.spentTodayAtomic,
        spendDayUtc: accountRow.spendDayUtc,
        requestsThisHour: accountRow.requestsThisHour,
        hourWindowStart: accountRow.hourWindowStart,
        machineSpendingStatus: accountRow.machineSpendingStatus as SpendState["machineSpendingStatus"],
      };
      const [globalRow] = await tx
        .select()
        .from(economicGlobalControls)
        .where(eq(economicGlobalControls.id, "global"))
        .limit(1);
      const globalControls: EconomicGlobalControls = globalRow
        ? {
            pauseAllAutonomousAgents: globalRow.pauseAllAutonomousAgents,
            pauseNewEntries: globalRow.pauseNewEntries,
            pauseMachineServiceSpending: globalRow.pauseMachineServiceSpending,
            disableX402Globally: globalRow.disableX402Globally,
            emergencyDenyAllMachinePayments: globalRow.emergencyDenyAllMachinePayments,
            disabledProviders: globalRow.disabledProviders ?? [],
            disabledCategories: (globalRow.disabledCategories ?? []) as ServiceCategory[],
          }
        : { ...DEFAULT_GLOBAL_CONTROLS };

      const decision = evaluateEconomicPolicy({
        mandate,
        request: input.request,
        spendState,
        agentStatus: input.agentStatus,
        provider: input.provider,
        globalControls,
        now,
      });

      const amountAtomic = input.request.quotedPriceAtomic ?? input.request.maxPriceAtomic;
      const [inserted] = await tx
        .insert(x402PaymentRecords)
        .values({
          decisionId: input.request.decisionId,
          agentId: input.agentId,
          providerId: input.provider?.id ?? input.request.providerId ?? "unknown",
          serviceCategory: input.request.category,
          requestNonce: input.request.requestNonce,
          requestHash: input.requestHash,
          idempotencyKey: input.request.idempotencyKey,
          amountAtomic,
          asset: input.request.asset,
          network: input.provider?.network ?? "eip155:4663",
          paymentMode: input.paymentMode ?? "EXACT",
          settlementMode: input.settlementMode ?? "PAPER_REHEARSAL",
          status: decision.allowed ? "AUTHORIZED" : "DENIED",
          reasonCode: decision.reasonCode,
          paymentChallenge: input.paymentChallenge ?? null,
          economicMandateHash: accountRow.mandateHash,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // If UTC day or hour rolled over, normalize counters even on authorization.
      if (accountRow.spendDayUtc !== currentDay || accountRow.hourWindowStart.slice(0, 13) !== currentHour.slice(0, 13)) {
        await tx
          .update(agentEconomicAccounts)
          .set({
            spentTodayAtomic: accountRow.spendDayUtc === currentDay ? accountRow.spentTodayAtomic : "0",
            spendDayUtc: currentDay,
            requestsThisHour: accountRow.hourWindowStart.slice(0, 13) === currentHour.slice(0, 13) ? accountRow.requestsThisHour : 0,
            hourWindowStart: accountRow.hourWindowStart.slice(0, 13) === currentHour.slice(0, 13) ? accountRow.hourWindowStart : currentHour,
            updatedAt: now,
          })
          .where(eq(agentEconomicAccounts.id, accountRow.id));
      }

      return {
        decision,
        paymentRecord: toPaymentView(inserted!),
        duplicate: false,
        mandateHash: accountRow.mandateHash,
      };
    });
  }

  async reconcilePaymentSettlement(input: {
    paymentRecordId: string;
    agentId: string;
    settled: boolean;
    paymentReference: string | null;
    settlementReference: string | null;
    txHash: string | null;
    settlementMode: SettlementMode;
    responseHash: string | null;
    validationStatus: "PENDING" | "VALIDATED" | "REJECTED";
    validationReason: string | null;
    now?: Date;
  }): Promise<{ paymentRecord: X402PaymentRecordView; account: AgentEconomicAccountView }> {
    const now = input.now ?? new Date();
    const currentDay = now.toISOString().slice(0, 10);
    const currentHour = now.toISOString();

    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .select()
        .from(x402PaymentRecords)
        .where(and(eq(x402PaymentRecords.id, input.paymentRecordId), eq(x402PaymentRecords.agentId, input.agentId)))
        .limit(1);
      if (!record) throw new Error("x402 payment record not found for reconciliation.");

      const [accountRow] = await tx
        .select()
        .from(agentEconomicAccounts)
        .where(eq(agentEconomicAccounts.agentId, input.agentId))
        .limit(1);
      if (!accountRow) throw new Error("Agent economic account not found.");

      const alreadyDebited = record.status === "SETTLED" || record.status === "RECONCILED";
      let updatedAccount = accountRow;

      if (input.settled && !alreadyDebited) {
        const spentTodayBase = accountRow.spendDayUtc === currentDay ? accountRow.spentTodayAtomic : "0";
        const reqsHourBase = accountRow.hourWindowStart.slice(0, 13) === currentHour.slice(0, 13) ? accountRow.requestsThisHour : 0;
        const nextBalance =
          cmpAtomic(accountRow.serviceBalanceAtomic, record.amountAtomic) >= 0
            ? subAtomic(accountRow.serviceBalanceAtomic, record.amountAtomic)
            : "0";
        const nextSpentToday = addAtomic(spentTodayBase, record.amountAtomic);
        const nextTotalSpent = addAtomic(accountRow.totalSpentAtomic, record.amountAtomic);
        const mandate = EconomicMandateSchema.parse(accountRow.mandate);
        const isExhausted =
          BigInt(nextBalance) === 0n || cmpAtomic(nextSpentToday, mandate.dailyServiceBudgetAtomic) >= 0;

        const [savedAcct] = await tx
          .update(agentEconomicAccounts)
          .set({
            serviceBalanceAtomic: nextBalance,
            spentTodayAtomic: nextSpentToday,
            totalSpentAtomic: nextTotalSpent,
            spendDayUtc: currentDay,
            requestsThisHour: reqsHourBase + 1,
            hourWindowStart: accountRow.hourWindowStart.slice(0, 13) === currentHour.slice(0, 13) ? accountRow.hourWindowStart : currentHour,
            machineSpendingStatus: isExhausted ? "EXHAUSTED" : accountRow.machineSpendingStatus,
            updatedAt: now,
          })
          .where(eq(agentEconomicAccounts.id, accountRow.id))
          .returning();
        updatedAccount = savedAcct!;
      }

      const [updatedRecord] = await tx
        .update(x402PaymentRecords)
        .set({
          status: input.settled ? "RECONCILED" : "FAILED",
          settlementMode: input.settlementMode,
          paymentReference: input.paymentReference,
          settlementReference: input.settlementReference,
          txHash: input.txHash,
          responseHash: input.responseHash,
          validationStatus: input.validationStatus,
          validationReason: input.validationReason,
          updatedAt: now,
        })
        .where(eq(x402PaymentRecords.id, record.id))
        .returning();

      return {
        paymentRecord: toPaymentView(updatedRecord!),
        account: toAccountView(updatedAccount, now),
      };
    });
  }

  async listPaymentHistory(agentId: string, limit = 50): Promise<X402PaymentRecordView[]> {
    const rows = await this.db
      .select()
      .from(x402PaymentRecords)
      .where(eq(x402PaymentRecords.agentId, agentId))
      .orderBy(desc(x402PaymentRecords.createdAt))
      .limit(limit);
    return rows.map(toPaymentView);
  }

  async countOnchainSettledPayments(agentId?: string): Promise<number> {
    const rows = agentId
      ? await this.db
          .select({ id: x402PaymentRecords.id })
          .from(x402PaymentRecords)
          .where(and(eq(x402PaymentRecords.agentId, agentId), eq(x402PaymentRecords.settlementMode, "ONCHAIN_SETTLED")))
      : await this.db
          .select({ id: x402PaymentRecords.id })
          .from(x402PaymentRecords)
          .where(eq(x402PaymentRecords.settlementMode, "ONCHAIN_SETTLED"));
    return rows.length;
  }

  async listEconomicTapeEvents(agentId: string, limit = 100): Promise<X402TapeEventRecord[]> {
    const rows = await this.db
      .select()
      .from(x402TapeEvents)
      .where(eq(x402TapeEvents.agentId, agentId))
      .orderBy(desc(x402TapeEvents.createdAt))
      .limit(limit);
    return rows.map(toTapeEventView);
  }

  async listBudgetEvents(agentId: string, limit = 30) {
    return this.db
      .select()
      .from(agentEconomicBudgetEvents)
      .where(eq(agentEconomicBudgetEvents.agentId, agentId))
      .orderBy(desc(agentEconomicBudgetEvents.createdAt))
      .limit(limit);
  }

  async getAgentOwnerId(agentId: string): Promise<{ ownerId: string; kind: string; status: string } | null> {
    const [row] = await this.db
      .select({ ownerId: agents.ownerId, kind: agents.kind, status: agents.status })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    return row ?? null;
  }
}
