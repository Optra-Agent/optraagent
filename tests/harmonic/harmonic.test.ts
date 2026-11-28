import { describe, expect, it, vi } from "vitest";
import {
  computeCommitmentHash,
  decryptSecret,
  encryptSecret,
} from "../../lib/harmonic/crypto";
import {
  checkCoveredCallExposureInvariant,
  checkPerRequestSpendingCap,
  checkServiceBudgetHardCap,
  checkTradingServiceCapitalIsolation,
} from "../../lib/harmonic/kernels";
import { HarmonicService } from "../../lib/harmonic/service";
import type { HarmonicAgentClient } from "../../lib/harmonic/types";

describe("Harmonic Crypto & Commitments", () => {
  it("encrypts and decrypts secrets symmetrically", () => {
    const secret = "ag_0123456789abcdef0123456789abcdef0123456789abcdef";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("computes canonical sha256 commitment hash", () => {
    const hash = computeCommitmentHash("nvda", "up", "1d", "salt1234");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(computeCommitmentHash("NVDA", "up", "1d", "salt1234"));
  });
});

describe("Harmonic Critical Kernels", () => {
  it("enforces service budget hard cap (P5)", () => {
    expect(checkServiceBudgetHardCap(800_000n, 200_000n, 1_000_000n)).toBe(true);
    expect(checkServiceBudgetHardCap(900_000n, 200_000n, 1_000_000n)).toBe(false);
  });

  it("enforces per-request spending cap (P6)", () => {
    expect(checkPerRequestSpendingCap(50_000n, 100_000n)).toBe(true);
    expect(checkPerRequestSpendingCap(150_000n, 100_000n)).toBe(false);
  });

  it("enforces trading capital and service budget isolation (P7)", () => {
    expect(checkTradingServiceCapitalIsolation("SERVICE_BUDGET")).toBe(true);
    expect(checkTradingServiceCapitalIsolation("TRADING_CAPITAL")).toBe(false);
  });

  it("enforces covered call exposure invariant (P1)", () => {
    expect(checkCoveredCallExposureInvariant(1, 100, false)).toBe(true);
    expect(checkCoveredCallExposureInvariant(2, 100, false)).toBe(false);
    expect(checkCoveredCallExposureInvariant(1, 100, true)).toBe(false);
  });
});

describe("HarmonicService Registration & Filing", () => {
  it("prevents duplicate registration when already REGISTERED", async () => {
    const mockRepo = {
      getPublicBinding: vi.fn().mockResolvedValue({
        optraAgentId: "agent-1",
        harmonicRegistryId: "a-123",
        harmonicIdentity: "OPTRA Pilot",
        registrationStatus: "REGISTERED",
      }),
    } as unknown as ConstructorParameters<typeof HarmonicService>[0];

    const mockClient: HarmonicAgentClient = {
      registerAgent: vi.fn(),
      fileExpectation: vi.fn(),
      seal: vi.fn(),
      reveal: vi.fn(),
      getRegistryRecord: vi.fn(),
    };

    const service = new HarmonicService(mockRepo, mockClient);
    const binding = await service.ensureAgentRegistered({
      optraAgentId: "agent-1",
      name: "OPTRA Pilot",
    });

    expect(binding.harmonicRegistryId).toBe("a-123");
    expect(mockClient.registerAgent).not.toHaveBeenCalled();
  });

  it("blocks action when harmonicRequiredBeforeExecution is true and filing fails", async () => {
    const mockRepo = {
      getVerificationPolicy: vi.fn().mockResolvedValue({
        harmonicRequiredBeforeExecution: true,
        filingMode: "PUBLIC_OPEN",
        onHarmonicUnavailable: "BLOCK_ACTION",
        requireProofBeforeActivation: false,
      }),
      appendTapeEvent: vi.fn().mockResolvedValue({}),
      createExpectation: vi.fn().mockResolvedValue({ id: "exp-1", status: "FAILED" }),
      getDecryptedSecret: vi.fn().mockResolvedValue(null),
    } as unknown as ConstructorParameters<typeof HarmonicService>[0];

    const mockClient: HarmonicAgentClient = {
      registerAgent: vi.fn(),
      fileExpectation: vi.fn(),
      seal: vi.fn(),
      reveal: vi.fn(),
      getRegistryRecord: vi.fn(),
    };

    const service = new HarmonicService(mockRepo, mockClient);
    const res = await service.filePreActionExpectation({
      agentId: "agent-1",
      decisionId: "dec-1",
      underlying: "NVDA",
      strategy: "COVERED_CALL",
      action: "OPEN",
      direction: "up",
      expectedCondition: "NVDA upside",
      recipeHash: "sha256:1",
      strategyMandateHash: "sha256:2",
      riskMandateHash: "sha256:3",
      economicMandateHash: "sha256:4",
      runtimeVersion: "optra.v3",
    });

    expect(res.allowed).toBe(false);
    expect(res.unverified).toBe(true);
  });
});

