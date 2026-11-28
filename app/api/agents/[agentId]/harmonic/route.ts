import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDatabase } from "../../../../../lib/db/client";
import { agents } from "../../../../../db/schema";
import { HarmonicRepository } from "../../../../../lib/harmonic/repository";
import { HarmonicService } from "../../../../../lib/harmonic/service";
import { KernelVerificationService } from "../../../../../lib/harmonic/kernels";
import { hashCanonical } from "../../../../../lib/harmonic/crypto";

export async function GET(
  _req: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  const db = await getDatabase();
  const repo = new HarmonicRepository(db);

  const [binding, policy, expectations, grades, proofs, tapeEvents] = await Promise.all([
    repo.getPublicBinding(agentId),
    repo.getVerificationPolicy(agentId),
    repo.listExpectations(agentId, 15),
    repo.listGrades(agentId, 15),
    repo.listProofs(agentId, 5),
    repo.listTapeEvents(agentId, 30),
  ]);

  return NextResponse.json({
    binding,
    policy,
    expectations,
    grades,
    proofs,
    tapeEvents,
  });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  const db = await getDatabase();
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const repo = new HarmonicRepository(db);
  const service = new HarmonicService(repo);
  const kernelService = new KernelVerificationService(repo);

  try {
    if (action === "register") {
      const binding = await service.ensureAgentRegistered({
        optraAgentId: agent.id,
        name: String(body.name ?? agent.name).slice(0, 40),
        kind: "mcp",
        url: "https://optraagent.cc",
      });
      return NextResponse.json({ ok: true, binding });
    }

    if (action === "updatePolicy") {
      const policy = await repo.upsertVerificationPolicy(agent.id, {
        harmonicRequiredBeforeExecution: Boolean(body.harmonicRequiredBeforeExecution),
        filingMode: (body.filingMode as "PUBLIC_OPEN" | "SEALED" | "DISABLED") ?? "PUBLIC_OPEN",
        onHarmonicUnavailable:
          (body.onHarmonicUnavailable as
            | "BLOCK_ACTION"
            | "ALLOW_WITH_UNVERIFIED_LABEL"
            | "PAUSE_AGENT") ?? "ALLOW_WITH_UNVERIFIED_LABEL",
        requireProofBeforeActivation: Boolean(body.requireProofBeforeActivation),
      });
      return NextResponse.json({ ok: true, policy });
    }

    if (action === "verify") {
      const proof = await kernelService.verifyAgentKernels({
        agentId: agent.id,
        recipeHash: agent.recipeHash,
        strategyMandateHash: hashCanonical(agent.recipe),
        riskMandateHash: hashCanonical({ allowNakedShortOptions: false }),
        economicMandateHash: hashCanonical({ allowTradingCapitalForServices: false }),
        dailyBudgetAtomic: 1_000_000n,
        perRequestLimitAtomic: 100_000n,
        allowNakedShortOptions: false,
        contractAddress: typeof body.contractAddress === "string" ? body.contractAddress : undefined,
      });
      return NextResponse.json({ ok: true, proof });
    }

    if (action === "file") {
      const underlying = String(body.underlying ?? agent.recipe.underlyingSymbol ?? "NVDA").toUpperCase();
      const direction = (body.direction === "down" ? "down" : "up") as "up" | "down";
      const decisionId = `manual-${agent.id.slice(0, 8)}-${Date.now()}`;
      const result = await service.filePreActionExpectation({
        agentId: agent.id,
        decisionId,
        underlying,
        strategy: agent.templateId,
        action: "MANUAL_FILING",
        direction,
        horizon: "1d",
        expectedCondition: `${agent.templateId} ${direction} expectation on ${underlying}`,
        recipeHash: agent.recipeHash,
        strategyMandateHash: hashCanonical(agent.recipe),
        riskMandateHash: hashCanonical({ allowNakedShortOptions: false }),
        economicMandateHash: hashCanonical({ allowTradingCapitalForServices: false }),
        runtimeVersion: "optra.runtime.v3",
      });
      if (!result.unverified) {
        await service.recordOutcomeAndGrade({
          agentId: agent.id,
          decisionId,
          ruleCompliance: "PASS",
          expectationOutcome: "PENDING",
        });
      }
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "reveal" && typeof body.decisionId === "string") {
      const expectation = await service.revealExpectation(agent.id, body.decisionId);
      return NextResponse.json({ ok: true, expectation });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Harmonic action failed" },
      { status: 500 },
    );
  }
}
