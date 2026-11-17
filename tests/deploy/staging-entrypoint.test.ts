import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temporaryRoot = mkdtempSync(path.join(tmpdir(), "optra-staging-deploy-test-"));
const fakeBin = path.join(temporaryRoot, "bin");
const dockerCalls = path.join(temporaryRoot, "docker-calls.log");
const entrypoint = path.resolve("deploy/staging/deploy-optra-staging.sh");

mkdirSync(fakeBin);
const fakeDocker = path.join(fakeBin, "docker");
writeFileSync(fakeDocker, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$OPTRA_TEST_DOCKER_CALLS\"\n", "utf8");
chmodSync(fakeDocker, 0o755);

function runEntrypoint(args: string[]) {
  return spawnSync("bash", [entrypoint, ...args], {
    encoding: "utf8",
    input: "test-token-not-a-real-credential\n",
    env: {
      ...process.env,
      OPTRA_TEST_DOCKER_CALLS: dockerCalls,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });
}

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("OPTRA staging deployment entrypoint", () => {
  it("rejects mutable GHCR tags before contacting Docker", () => {
    const result = runEntrypoint([
      "deploy",
      "ghcr.io/optra-agent/optraagent:latest",
      "--registry-username",
      "optra-ghcr-operator",
      "--registry-token-stdin",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("immutable full-SHA image tag");
    expect(existsSync(dockerCalls)).toBe(false);
  });

  it("rejects unknown operations without invoking Docker", () => {
    const result = runEntrypoint(["down"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Usage:");
    expect(existsSync(dockerCalls)).toBe(false);
  });

  it.skipIf(typeof process.getuid === "function" && process.getuid() === 0)(
    "fails closed when a deploy is invoked without the root-owned VPS context",
    () => {
      const result = runEntrypoint([
        "deploy",
        `ghcr.io/optra-agent/optraagent:sha-${"a".repeat(40)}`,
        "--registry-username",
        "optra-ghcr-operator",
        "--registry-token-stdin",
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must run as root");
      expect(existsSync(dockerCalls)).toBe(false);
    },
  );
});
