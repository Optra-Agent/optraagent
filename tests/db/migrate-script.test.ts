import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("requires an explicit PostgreSQL target before running production migrations", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const result = spawnSync("bun", ["run", "db:migrate"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain("DATABASE_URL is required");
  expect(`${result.stdout}\n${result.stderr}`).not.toContain("ERR_MODULE_NOT_FOUND");
});
