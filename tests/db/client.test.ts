import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../lib/db/client";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";

const ADDRESS = "0xfcad0b19bb29d4674531d6f115237e16afce377c" as const;

describe("database connection policy", () => {
  let rootDir: string;

  afterEach(() => {
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
  });

  it("local_database_persists_owner_data_between_connections", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-local-db-"));
    const dataDir = join(rootDir, "database");
    const first = await createDatabase({ dataDir, nodeEnv: "development" });
    const firstRepository = new DrizzleAuthRepository(first.db);
    const owner = await firstRepository.findOrCreateUser(ADDRESS);
    await first.close();

    const second = await createDatabase({ dataDir, nodeEnv: "development" });
    const secondRepository = new DrizzleAuthRepository(second.db);
    await expect(secondRepository.findOrCreateUser(ADDRESS)).resolves.toEqual(owner);
    await second.close();
  });

  it("creates_parent_directories_for_the_local_database", async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-local-db-parent-"));
    const dataDir = join(rootDir, "nested", "database");

    const connection = await createDatabase({ dataDir, nodeEnv: "development" });
    await expect(connection.db.query.users.findMany()).resolves.toEqual([]);
    await connection.close();
  });

  it("production_requires_an_explicit_postgres_url", async () => {
    await expect(createDatabase({ nodeEnv: "production" })).rejects.toThrow("DATABASE_URL is required in production.");
  });
});
