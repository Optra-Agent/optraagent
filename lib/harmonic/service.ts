import { computeCommitmentHash, decryptSecret, generateSalt, hashCanonical } from "./crypto";
import { McpHarmonicAgentClient } from "./client";
import { HarmonicRepository } from "./repository";
import type {
  HarmonicAgentClient,
  HarmonicDirection,
  HarmonicFilingMode,
  HarmonicHorizon,
  OptraExpectationPayload,
} from "./types";

export class HarmonicService {
  constructor(
    private readonly repo: HarmonicRepository = new HarmonicRepository(),
    private readonly client: HarmonicAgentClient = new McpHarmonicAgentClient(),
  ) {}

  async ensureAgentRegistered(input: {
    optraAgentId: string;
    name: string;
    decisionId?: string;
    kind?: "mcp" | "robinhood" | "factory" | "terminal" | "other";
    url?: string;
  }) {
    const existing = await this.repo.getPublicBinding(input.optraAgentId);
    if (existing && existing.registrationStatus === "REGISTERED" && existing.harmonicRegistryId) {
      return existing;
    }

    const decisionId = input.decisionId ?? `reg-${input.optraAgentId}-${Date.now()}`;

    await this.repo.upsertBinding({
      optraAgentId: input.optraAgentId,
      registrationStatus: "REGISTERING",
    });

    await this.repo.appendTapeEvent({
      decisionId,
      agentId: input.optraAgentId,
      eventType: "HARMONIC_REGISTRATION_REQUESTED",
      status: "REGISTERING",
      reason: `Requesting Harmonic Registry identity for ${input.name}`,
    });

    try {
      const reg = await this.client.registerAgent({
        name: input.name,
        kind: input.kind ?? "mcp",
        url: input.url ?? "https://optraagent.cc",
      });

      const saved = await this.repo.upsertBinding({
        optraAgentId: input.optraAgentId,
        harmonicRegistryId: reg.harmonicRegistryId,
        harmonicIdentity: reg.harmonicIdentity,
        registrationStatus: "REGISTERED",
        secret: reg.secret,
        registeredAt: new Date(),
        metadata: reg.raw,
      });

      await this.repo.appendTapeEvent({
        decisionId,
        agentId: input.optraAgentId,
        eventType: "HARMONIC_REGISTERED",
        harmonicReference: reg.harmonicRegistryId,
        status: "REGISTERED",
        externalUrl: reg.externalUrl,
        reason: `Registered on Harmonic Registry as ${reg.harmonicIdentity}`,
      });

      const { encryptedSecret: _s, ...safe } = saved;
      return safe;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Harmonic registration failed";
      await this.repo.upsertBinding({
        optraAgentId: input.optraAgentId,
        registrationStatus: "ERROR",
        lastError: message,
      });
      throw err;
    }
  }

  async filePreActionExpectation(input: {
    agentId: string;
    decisionId: string;
    underlying: string;
    strategy: string;
    action: string;
    direction: HarmonicDirection;
    horizon?: HarmonicHorizon;
    expectedCondition: string;
    recipeHash: string;
    strategyMandateHash: string;
    riskMandateHash: string;
    economicMandateHash: string;
    runtimeVersion: string;
    filingModeOverride?: HarmonicFilingMode;
  }) {
    const policy = await this.repo.getVerificationPolicy(input.agentId);
    const filingMode = input.filingModeOverride ?? policy.filingMode;
    const horizon = input.horizon ?? "1d";

    const payload: OptraExpectationPayload = {
      agent_id: input.agentId,
      decision_id: input.decisionId,
      underlying: input.underlying.toUpperCase(),
      strategy: input.strategy,
      action: input.action,
      directional_context: input.direction === "up" ? "BULLISH_OR_UPSIDE" : "DOWNSIDE_PROTECTION",
      horizon,
      expected_condition: input.expectedCondition,
      recipe_hash: input.recipeHash,
      strategy_mandate_hash: input.strategyMandateHash,
      risk_mandate_hash: input.riskMandateHash,
      economic_mandate_hash: input.economicMandateHash,
      runtime_version: input.runtimeVersion,
      created_at: new Date().toISOString(),
    };

    await this.repo.appendTapeEvent({
      decisionId: input.decisionId,
      agentId: input.agentId,
      eventType: "HARMONIC_EXPECTATION_CREATED",
      recipeHash: input.recipeHash,
      strategyMandateHash: input.strategyMandateHash,
      riskMandateHash: input.riskMandateHash,
      economicMandateHash: input.economicMandateHash,
      status: "CREATED",
      reason: `Pre-action expectation created for ${payload.underlying} (${input.direction}, ${horizon})`,
      metadata: { filingMode, expectationHash: hashCanonical(payload) },
    });

    if (filingMode === "DISABLED") {
      const exp = await this.repo.createExpectation({
        agentId: input.agentId,
        decisionId: input.decisionId,
        filingMode: "DISABLED",
        status: "SKIPPED",
        payload,
        direction: input.direction,
      });
      return { allowed: true, expectation: exp, unverified: true };
    }

    const secret = await this.repo.getDecryptedSecret(input.agentId);
    if (!secret) {
      const reason = "Agent is not registered on Harmonic Registry";
      const exp = await this.repo.createExpectation({
        agentId: input.agentId,
        decisionId: input.decisionId,
        filingMode,
        status: "FAILED",
        payload,
        direction: input.direction,
        errorMessage: reason,
      });

      await this.repo.appendTapeEvent({
        decisionId: input.decisionId,
        agentId: input.agentId,
        eventType: "HARMONIC_EXPECTATION_FAILED",
        recipeHash: input.recipeHash,
        strategyMandateHash: input.strategyMandateHash,
        riskMandateHash: input.riskMandateHash,
        economicMandateHash: input.economicMandateHash,
        status: "FAILED",
        reason,
      });

      const blocked =
        policy.harmonicRequiredBeforeExecution ||
        policy.onHarmonicUnavailable === "BLOCK_ACTION" ||
        policy.onHarmonicUnavailable === "PAUSE_AGENT";
      return { allowed: !blocked, expectation: exp, unverified: true, error: reason };
    }

    try {
      if (filingMode === "SEALED") {
        const salt = generateSalt();
        const commitment = computeCommitmentHash(
          payload.underlying,
          input.direction,
          horizon,
          salt,
        );
        const sealed = await this.client.seal({
          commitment,
          horizon,
          secret,
        });

        const exp = await this.repo.createExpectation({
          agentId: input.agentId,
          decisionId: input.decisionId,
          filingMode: "SEALED",
          status: "SEALED",
          payload,
          direction: input.direction,
          harmonicReference: sealed.harmonicReference,
          commitmentHash: commitment,
          salt,
          externalUrl: sealed.externalUrl,
        });

        await this.repo.appendTapeEvent({
          decisionId: input.decisionId,
          agentId: input.agentId,
          eventType: "HARMONIC_EXPECTATION_SEALED",
          recipeHash: input.recipeHash,
          strategyMandateHash: input.strategyMandateHash,
          riskMandateHash: input.riskMandateHash,
          economicMandateHash: input.economicMandateHash,
          harmonicReference: sealed.harmonicReference,
          status: "SEALED",
          externalUrl: sealed.externalUrl,
          reason: `Sealed commitment filed on Harmonic (${sealed.harmonicReference})`,
        });

        return { allowed: true, expectation: exp, unverified: false };
      }

      const filed = await this.client.fileExpectation({
        subject: payload.underlying,
        direction: input.direction,
        horizon,
        note: `OPTRA ${input.strategy} ${input.action} [${input.decisionId.slice(0, 12)}]`,
        secret,
      });

      const exp = await this.repo.createExpectation({
        agentId: input.agentId,
        decisionId: input.decisionId,
        filingMode: "PUBLIC_OPEN",
        status: "FILED",
        payload,
        direction: input.direction,
        harmonicReference: filed.harmonicReference,
        externalUrl: filed.externalUrl,
      });

      await this.repo.appendTapeEvent({
        decisionId: input.decisionId,
        agentId: input.agentId,
        eventType: "HARMONIC_EXPECTATION_FILED",
        recipeHash: input.recipeHash,
        strategyMandateHash: input.strategyMandateHash,
        riskMandateHash: input.riskMandateHash,
        economicMandateHash: input.economicMandateHash,
        harmonicReference: filed.harmonicReference,
        status: "FILED",
        externalUrl: filed.externalUrl,
        reason: `Open expectation filed on Harmonic (${filed.harmonicReference})`,
      });

      return { allowed: true, expectation: exp, unverified: false };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Harmonic filing failed";
      const exp = await this.repo.createExpectation({
        agentId: input.agentId,
        decisionId: input.decisionId,
        filingMode,
        status: "FAILED",
        payload,
        direction: input.direction,
        errorMessage: reason,
      });

      await this.repo.appendTapeEvent({
        decisionId: input.decisionId,
        agentId: input.agentId,
        eventType: "HARMONIC_EXPECTATION_FAILED",
        recipeHash: input.recipeHash,
        strategyMandateHash: input.strategyMandateHash,
        riskMandateHash: input.riskMandateHash,
        economicMandateHash: input.economicMandateHash,
        status: "FAILED",
        reason,
      });

      const blocked =
        policy.harmonicRequiredBeforeExecution ||
        policy.onHarmonicUnavailable === "BLOCK_ACTION" ||
        policy.onHarmonicUnavailable === "PAUSE_AGENT";
      return { allowed: !blocked, expectation: exp, unverified: true, error: reason };
    }
  }

  async revealExpectation(agentId: string, decisionId: string) {
    const exp = await this.repo.getExpectationByDecision(agentId, decisionId);
    if (!exp || exp.status !== "SEALED" || !exp.harmonicReference || !exp.encryptedSalt) {
      throw new Error("No sealed expectation found to reveal");
    }

    const secret = await this.repo.getDecryptedSecret(agentId);
    if (!secret) throw new Error("Agent Harmonic secret not found");

    const salt = decryptSecret(exp.encryptedSalt);
    const revealed = await this.client.reveal({
      id: exp.harmonicReference,
      subject: exp.underlying,
      direction: exp.direction as HarmonicDirection,
      salt,
      secret,
    });

    const updated = await this.repo.updateExpectationStatus(exp.id, {
      status: "REVEALED",
      harmonicReference: revealed.harmonicReference,
      externalUrl: revealed.externalUrl,
      revealedAt: new Date(),
    });

    await this.repo.appendTapeEvent({
      decisionId,
      agentId,
      eventType: "HARMONIC_EXPECTATION_REVEALED",
      recipeHash: exp.recipeHash,
      strategyMandateHash: exp.strategyMandateHash,
      riskMandateHash: exp.riskMandateHash,
      economicMandateHash: exp.economicMandateHash,
      harmonicReference: revealed.harmonicReference,
      status: "REVEALED",
      externalUrl: revealed.externalUrl,
      reason: `Sealed expectation revealed on Harmonic (${revealed.harmonicReference})`,
    });

    return updated;
  }

  async recordOutcomeAndGrade(input: {
    agentId: string;
    decisionId: string;
    ruleCompliance: "PASS" | "FAIL" | "UNKNOWN";
    expectationOutcome: "CORRECT" | "INCORRECT" | "INDETERMINATE" | "PENDING";
    executionQuality?: number | null;
    pnl?: string | null;
    evidenceRefs?: string[];
  }) {
    const exp = await this.repo.getExpectationByDecision(input.agentId, input.decisionId);
    const grade = await this.repo.upsertGrade({
      agentId: input.agentId,
      decisionId: input.decisionId,
      expectationId: exp?.id ?? null,
      harmonicReference: exp?.harmonicReference ?? null,
      ruleCompliance: input.ruleCompliance,
      expectationOutcome: input.expectationOutcome,
      executionQuality: input.executionQuality ?? null,
      pnl: input.pnl ?? null,
      evidenceRefs: input.evidenceRefs ?? [],
    });

    await this.repo.appendTapeEvent({
      decisionId: input.decisionId,
      agentId: input.agentId,
      eventType: input.expectationOutcome === "PENDING" ? "HARMONIC_GRADE_PENDING" : "HARMONIC_GRADED",
      harmonicReference: exp?.harmonicReference ?? null,
      status: input.expectationOutcome,
      reason: `Decision graded: ruleCompliance=${input.ruleCompliance}, outcome=${input.expectationOutcome}`,
    });

    return grade;
  }
}

