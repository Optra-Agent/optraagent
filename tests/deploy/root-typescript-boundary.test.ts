import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootTsconfigPath = new URL("../../tsconfig.json", import.meta.url);
const dockerignorePath = new URL("../../.dockerignore", import.meta.url);
const eslintConfigPath = new URL("../../eslint.config.mjs", import.meta.url);

describe("application TypeScript boundary", () => {
  it("keeps the independent Foundry workspace outside the Next.js project check", () => {
    const tsconfig = JSON.parse(readFileSync(rootTsconfigPath, "utf8")) as {
      exclude?: string[];
    };

    expect(tsconfig.exclude).toContain("contracts");
  });

  it("keeps the independent Foundry workspace out of the paper application image context", () => {
    const dockerignore = readFileSync(dockerignorePath, "utf8").split(/\r?\n/);

    expect(dockerignore).toContain("contracts/");
  });

  it("keeps the independent Foundry workspace outside the Next.js lint target", () => {
    const eslintConfig = readFileSync(eslintConfigPath, "utf8");

    expect(eslintConfig).toContain("contracts/**");
  });
});
