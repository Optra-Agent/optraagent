import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = new URL("../../.github/workflows/staging-image.yml", import.meta.url);

describe("staging image workflow", () => {
  it("keeps GHCR publishing behind an owner-controlled release gate", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toMatch(/publish:\s*\n\s+description:/);
    expect(workflow).toMatch(/publish:\s*\n\s+description:[\s\S]*?default:\s*false/);
    expect(workflow).toContain("vars.OPTRA_GHCR_PUBLISH_ENABLED == 'true'");
    expect(workflow).toContain("environment: optra-ghcr-publish");
    expect(workflow).toContain("packages: write");
    expect(workflow.match(/packages: write/g)).toHaveLength(1);
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("inputs.publish == true");
    expect(workflow).toContain("inputs.release_commit");
    expect(workflow).toContain("docker manifest inspect");
    expect(workflow).toContain("sha-${RELEASE_COMMIT}");
    expect(workflow).not.toMatch(/\bssh\b|deploy-optra-staging\.sh/);
  });

  it("runs the production toolchain, PostgreSQL migrations, isolated browser suite, and image smoke checks", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("node-version: 26.12.1");
    expect(workflow).toContain("bun-version: 1.3.14");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("bun run db:migrate");
    expect(workflow).toContain("OPTRA_TEST_POSTGRES_URL");
    expect(workflow).toContain("bun run typecheck");
    expect(workflow).toContain("bun run lint");
    expect(workflow).toContain("bun run test:e2e");
    expect(workflow).toContain("bun run build");
    expect(workflow).toContain("docker build");
    expect(workflow).toContain("/api/health/ready");
    expect(workflow).toContain("LIVE_TRADING_ENABLED=false");
    expect(workflow).toContain("V4_CLAIM_LEVEL=L0");
  });
});
