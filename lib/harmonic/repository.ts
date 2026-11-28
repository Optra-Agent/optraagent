import { desc, eq, and } from "drizzle-orm";
import { getDatabase, type AppDatabase } from "../db/client";
import {
  harmonicAgentBindings,
  harmonicExpectations,
  harmonicTapeEvents,
  optraGrades,
  optraProofs,
  verificationPolicies,
} from "../../db/schema";
import { decryptSecret, encryptSecret, fingerprintSecret } from "./crypto";
import type {
  HarmonicFilingMode,
  HarmonicRegistrationStatus,
  HarmonicTapeEventType,
  OptraExpectationPayload,
  ProofPropertyResult,
  ProofStatus,
  VerificationPolicyConfig,
} from "./types";

export class HarmonicRepository {
  constructor(private readonly dbInstance?: AppDatabase) {}

  private async getDb(): Promise<AppDatabase> {
    return this.dbInstance ?? getDatabase();
  }

  async getBinding(optraAgentId: string) {
    const [row] = await (await this.getDb())
      .select()
      .from(harmonicAgentBindings)
      .where(eq(harmonicAgentBindings.optraAgentId, optraAgentId))
      .limit(1);
    return row ?? null;
  }

  async getPublicBinding(optraAgentId: string) {
    const row = await this.getBinding(optraAgentId);
    if (!row) return null;
    const { encryptedSecret: _secret, ...safe } = row;
    return safe;
  }

  async getDecryptedSecret(optraAgentId: string): Promise<string | null> {
    const row = await this.getBinding(optraAgentId);
    if (!row?.encryptedSecret) return null;
    return decryptSecret(row.encryptedSecret);
  }

  async upsertBinding(input: {
    optraAgentId: string;
    harmonicRegistryId?: string | null;
    harmonicIdentity?: string | null;
    registrationStatus: HarmonicRegistrationStatus;
    secret?: string | null;
    registeredAt?: Date | null;
    lastError?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const existing = await this.getBinding(input.optraAgentId);
    const encryptedSecret = input.secret ? encryptSecret(input.secret) : existing?.encryptedSecret ?? null;
    const secretFingerprint = input.secret
      ? fingerprintSecret(input.secret)
      : existing?.secretFingerprint ?? null;

    if (existing) {
      const [updated] = await (await this.getDb())
        .update(harmonicAgentBindings)
        .set({
          harmonicRegistryId: input.harmonicRegistryId ?? existing.harmonicRegistryId,
          harmonicIdentity: input.harmonicIdentity ?? existing.harmonicIdentity,
          registrationStatus: input.registrationStatus,
          encryptedSecret,
          secretFingerprint,
          registeredAt: input.registeredAt ?? existing.registeredAt,
          lastError: input.lastError ?? null,
          metadata: input.metadata ?? existing.metadata,
          updatedAt: new Date(),
        })
        .where(eq(harmonicAgentBindings.optraAgentId, input.optraAgentId))
        .returning();
      return updated;
    }

    const [created] = await (await this.getDb())
      .insert(harmonicAgentBindings)
      .values({
        optraAgentId: input.optraAgentId,
        harmonicRegistryId: input.harmonicRegistryId ?? null,
        harmonicIdentity: input.harmonicIdentity ?? null,
        registrationStatus: input.registrationStatus,
        encryptedSecret,
        secretFingerprint,
        registeredAt: input.registeredAt ?? null,
        lastError: input.lastError ?? null,
        metadata: input.metadata ?? {},
      })
      .returning();
    return created;
  }

  async getVerificationPolicy(agentId: string): Promise<VerificationPolicyConfig> {
    const [row] = await (await this.getDb())
      .select()
      .from(verificationPolicies)
      .where(eq(verificationPolicies.agentId, agentId))
      .limit(1);

    if (!row) {
      return {
        harmonicRequiredBeforeExecution: false,
        filingMode: "PUBLIC_OPEN",
        onHarmonicUnavailable: "ALLOW_WITH_UNVERIFIED_LABEL",
        requireProofBeforeActivation: false,
      };
    }

    return {
      harmonicRequiredBeforeExecution: row.harmonicRequiredBeforeExecution,
      filingMode: row.filingMode as HarmonicFilingMode,
      onHarmonicUnavailable: row.onHarmonicUnavailable as VerificationPolicyConfig["onHarmonicUnavailable"],
      requireProofBeforeActivation: row.requireProofBeforeActivation,
    };
  }

  async upsertVerificationPolicy(agentId: string, policy: Partial<VerificationPolicyConfig>) {
    const current = await this.getVerificationPolicy(agentId);
    const next = { ...current, ...policy };

    const [existing] = await (await this.getDb())
      .select()
      .from(verificationPolicies)
      .where(eq(verificationPolicies.agentId, agentId))
      .limit(1);

    if (existing) {
      const [updated] = await (await this.getDb())
        .update(verificationPolicies)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(verificationPolicies.agentId, agentId))
        .returning();
      return updated;
    }

    const [created] = await (await this.getDb())
      .insert(verificationPolicies)
      .values({ agentId, ...next })
      .returning();
    return created;
  }

  async createExpectation(input: {
    agentId: string;
    decisionId: string;
    filingMode: HarmonicFilingMode;
    status: string;
    payload: OptraExpectationPayload;
    direction: "up" | "down";
    harmonicReference?: string | null;
    commitmentHash?: string | null;
    salt?: string | null;
    externalUrl?: string | null;
    errorMessage?: string | null;
  }) {
    const encryptedSalt = input.salt ? encryptSecret(input.salt) : null;
    const [row] = await (await this.getDb())
      .insert(harmonicExpectations)
      .values({
        agentId: input.agentId,
        decisionId: input.decisionId,
        filingMode: input.filingMode,
        status: input.status,
        underlying: input.payload.underlying,
        strategy: input.payload.strategy,
        action: input.payload.action,
        direction: input.direction,
        horizon: input.payload.horizon,
        expectedCondition: input.payload.expected_condition,
        recipeHash: input.payload.recipe_hash,
        strategyMandateHash: input.payload.strategy_mandate_hash,
        riskMandateHash: input.payload.risk_mandate_hash,
        economicMandateHash: input.payload.economic_mandate_hash,
        runtimeVersion: input.payload.runtime_version,
        harmonicReference: input.harmonicReference ?? null,
        commitmentHash: input.commitmentHash ?? null,
        encryptedSalt,
        externalUrl: input.externalUrl ?? null,
        payload: input.payload as unknown as Record<string, unknown>,
        errorMessage: input.errorMessage ?? null,
      })
      .returning();
    return row;
  }

  async updateExpectationStatus(
    id: string,
    patch: {
      status: string;
      harmonicReference?: string | null;
      externalUrl?: string | null;
      errorMessage?: string | null;
      revealedAt?: Date | null;
    },
  ) {
    const [updated] = await (await this.getDb())
      .update(harmonicExpectations)
      .set({
        status: patch.status,
        harmonicReference: patch.harmonicReference,
        externalUrl: patch.externalUrl,
        errorMessage: patch.errorMessage ?? null,
        revealedAt: patch.revealedAt ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(harmonicExpectations.id, id))
      .returning();
    return updated;
  }

  async getExpectationByDecision(agentId: string, decisionId: string) {
    const [row] = await (await this.getDb())
      .select()
      .from(harmonicExpectations)
      .where(
        and(
          eq(harmonicExpectations.agentId, agentId),
          eq(harmonicExpectations.decisionId, decisionId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async listExpectations(agentId: string, limit = 20) {
    const rows = await (await this.getDb())
      .select()
      .from(harmonicExpectations)
      .where(eq(harmonicExpectations.agentId, agentId))
      .orderBy(desc(harmonicExpectations.createdAt))
      .limit(limit);
    return rows.map(({ encryptedSalt: _s, ...safe }) => safe);
  }

  async upsertGrade(input: {
    agentId: string;
    decisionId: string;
    expectationId?: string | null;
    harmonicReference?: string | null;
    ruleCompliance: "PASS" | "FAIL" | "UNKNOWN";
    expectationOutcome: "CORRECT" | "INCORRECT" | "INDETERMINATE" | "PENDING";
    executionQuality?: number | null;
    pnl?: string | null;
    evidenceRefs?: string[];
    metadata?: Record<string, unknown>;
  }) {
    const [existing] = await (await this.getDb())
      .select()
      .from(optraGrades)
      .where(
        and(
          eq(optraGrades.agentId, input.agentId),
          eq(optraGrades.decisionId, input.decisionId),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await (await this.getDb())
        .update(optraGrades)
        .set({
          expectationId: input.expectationId ?? existing.expectationId,
          harmonicReference: input.harmonicReference ?? existing.harmonicReference,
          ruleCompliance: input.ruleCompliance,
          expectationOutcome: input.expectationOutcome,
          executionQuality: input.executionQuality ?? existing.executionQuality,
          pnl: input.pnl ?? existing.pnl,
          evidenceRefs: input.evidenceRefs ?? existing.evidenceRefs,
          metadata: input.metadata ?? existing.metadata,
          gradedAt: new Date(),
        })
        .where(eq(optraGrades.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await (await this.getDb())
      .insert(optraGrades)
      .values({
        agentId: input.agentId,
        decisionId: input.decisionId,
        expectationId: input.expectationId ?? null,
        harmonicReference: input.harmonicReference ?? null,
        ruleCompliance: input.ruleCompliance,
        expectationOutcome: input.expectationOutcome,
        executionQuality: input.executionQuality ?? null,
        pnl: input.pnl ?? null,
        evidenceRefs: input.evidenceRefs ?? [],
        metadata: input.metadata ?? {},
      })
      .returning();
    return created;
  }

  async listGrades(agentId: string, limit = 20) {
    return (await this.getDb())
      .select()
      .from(optraGrades)
      .where(eq(optraGrades.agentId, agentId))
      .orderBy(desc(optraGrades.gradedAt))
      .limit(limit);
  }

  async createProof(input: {
    agentId: string;
    status: ProofStatus;
    kernelName: string;
    kernelHash: string;
    recipeHash: string;
    strategyMandateHash: string;
    riskMandateHash: string;
    economicMandateHash: string;
    codeVersion: string;
    properties: ProofPropertyResult[];
    assumptions: string[];
    externalReference?: string | null;
    resolvedAt?: Date | null;
  }) {
    const [row] = await (await this.getDb())
      .insert(optraProofs)
      .values({
        agentId: input.agentId,
        proofProvider: "HARMONIC_AGENT",
        verifier: "ARISTOTLE",
        status: input.status,
        kernelName: input.kernelName,
        kernelHash: input.kernelHash,
        recipeHash: input.recipeHash,
        strategyMandateHash: input.strategyMandateHash,
        riskMandateHash: input.riskMandateHash,
        economicMandateHash: input.economicMandateHash,
        codeVersion: input.codeVersion,
        properties: input.properties,
        assumptions: input.assumptions,
        externalReference: input.externalReference ?? null,
        resolvedAt: input.resolvedAt ?? null,
      })
      .returning();
    return row;
  }

  async listProofs(agentId: string, limit = 10) {
    return (await this.getDb())
      .select()
      .from(optraProofs)
      .where(eq(optraProofs.agentId, agentId))
      .orderBy(desc(optraProofs.requestedAt))
      .limit(limit);
  }

  async markProofsStale(agentId: string) {
    return (await this.getDb())
      .update(optraProofs)
      .set({ status: "STALE" })
      .where(and(eq(optraProofs.agentId, agentId), eq(optraProofs.status, "PROVED")))
      .returning();
  }

  async appendTapeEvent(input: {
    decisionId: string;
    agentId: string;
    eventType: HarmonicTapeEventType;
    recipeHash?: string | null;
    strategyMandateHash?: string | null;
    riskMandateHash?: string | null;
    economicMandateHash?: string | null;
    kernelHash?: string | null;
    harmonicReference?: string | null;
    status: string;
    externalUrl?: string | null;
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    const [row] = await (await this.getDb())
      .insert(harmonicTapeEvents)
      .values({
        decisionId: input.decisionId,
        agentId: input.agentId,
        eventType: input.eventType,
        recipeHash: input.recipeHash ?? null,
        strategyMandateHash: input.strategyMandateHash ?? null,
        riskMandateHash: input.riskMandateHash ?? null,
        economicMandateHash: input.economicMandateHash ?? null,
        kernelHash: input.kernelHash ?? null,
        harmonicReference: input.harmonicReference ?? null,
        status: input.status,
        externalUrl: input.externalUrl ?? null,
        reason: input.reason,
        metadata: input.metadata ?? {},
      })
      .returning();
    return row;
  }

  async listTapeEvents(agentId: string, limit = 50) {
    return (await this.getDb())
      .select()
      .from(harmonicTapeEvents)
      .where(eq(harmonicTapeEvents.agentId, agentId))
      .orderBy(desc(harmonicTapeEvents.createdAt))
      .limit(limit);
  }
}
