import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { DrizzleAuthRepository } from "../../lib/auth/drizzle-repository";
import { schema } from "../../db/schema";

const ADDRESS = "0xfcad0b19bb29d4674531d6f115237e16afce377c" as const;
const TOKEN_HASH = "a".repeat(64);

describe("Drizzle auth repository", () => {
  let rootDir: string;
  let dataDir: string;
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: DrizzleAuthRepository;

  beforeEach(async () => {
    rootDir = mkdtempSync(join(tmpdir(), "optra-auth-db-"));
    dataDir = join(rootDir, "database");
    client = new PGlite(dataDir);
    db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    repository = new DrizzleAuthRepository(db);
  });

  afterEach(async () => {
    await client.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("normalizes_wallet_identity_and_reuses_the_same_owner", async () => {
    const first = await repository.findOrCreateUser(ADDRESS.toUpperCase().replace("0X", "0x") as `0x${string}`);
    const second = await repository.findOrCreateUser(ADDRESS);

    expect(first.id).toBe(second.id);
    expect(first.address).toBe(ADDRESS);
  });

  it("atomically_consumes_nonce_and_rejects_wrong_origin_or_expiry", async () => {
    const expiresAt = new Date("2026-11-12T03:05:00.000Z");
    const now = new Date("2026-11-12T03:00:00.000Z");
    await repository.createChallenge({
      nonce: "nonce-1",
      address: ADDRESS,
      origin: "http://localhost:3000",
      message: "challenge",
      expiresAt,
    });

    await expect(repository.consumeChallenge({
      nonce: "nonce-1",
      address: ADDRESS,
      origin: "https://attacker.example",
      now,
    })).resolves.toBeNull();
    await expect(repository.consumeChallenge({
      nonce: "nonce-1",
      address: ADDRESS,
      origin: "http://localhost:3000",
      now: expiresAt,
    })).resolves.toBeNull();

    const consumed = await repository.consumeChallenge({ nonce: "nonce-1", address: ADDRESS, origin: "http://localhost:3000", now });
    expect(consumed?.message).toBe("challenge");
    await expect(repository.consumeChallenge({ nonce: "nonce-1", address: ADDRESS, origin: "http://localhost:3000", now })).resolves.toBeNull();
  });

  it("stores_session_hash_without_raw_token_and_rejects_expired_or_revoked_sessions", async () => {
    const user = await repository.findOrCreateUser(ADDRESS);
    const expiresAt = new Date("2026-11-19T03:00:00.000Z");
    await repository.createSession({ tokenHash: TOKEN_HASH, userId: user.id, expiresAt, createdAt: new Date("2026-11-12T03:00:00.000Z") });

    await expect(repository.findSession(TOKEN_HASH, new Date("2026-11-12T03:00:00.000Z"))).resolves.toMatchObject({ user: { id: user.id } });
    await expect(repository.findSession(TOKEN_HASH, expiresAt)).resolves.toBeNull();
    await repository.revokeSession(TOKEN_HASH, new Date("2026-11-12T04:00:00.000Z"));
    await expect(repository.findSession(TOKEN_HASH, new Date("2026-11-12T04:00:01.000Z"))).resolves.toBeNull();
  });

  it("persists_owner_and_session_across_embedded_postgres_restart", async () => {
    const user = await repository.findOrCreateUser(ADDRESS);
    await repository.createSession({
      tokenHash: TOKEN_HASH,
      userId: user.id,
      expiresAt: new Date("2026-11-19T03:00:00.000Z"),
      createdAt: new Date("2026-11-12T03:00:00.000Z"),
    });
    await client.close();

    client = new PGlite(dataDir);
    db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    repository = new DrizzleAuthRepository(db);

    await expect(repository.findSession(TOKEN_HASH, new Date("2026-11-12T03:00:01.000Z"))).resolves.toMatchObject({
      user: { id: user.id, address: ADDRESS },
    });
  });
});
