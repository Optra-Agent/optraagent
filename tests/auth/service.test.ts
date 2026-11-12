import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletAuthService } from "../../lib/auth/service";
import type { AuthRepository, AuthenticatedWalletUser, StoredChallenge } from "../../lib/auth/types";

const APP_ORIGIN = "http://localhost:3000";
const ACCOUNT = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const OTHER_ACCOUNT = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdee");

function makeRepository(): AuthRepository {
  const challenges = new Map<string, StoredChallenge>();
  const consumed = new Set<string>();
  const users = new Map<string, AuthenticatedWalletUser>();
  const sessions = new Map<string, { userId: string; expiresAt: Date; revokedAt: Date | null }>();

  return {
    async createChallenge(challenge) {
      challenges.set(challenge.nonce, challenge);
    },
    async consumeChallenge(input) {
      const challenge = challenges.get(input.nonce);
      if (!challenge || consumed.has(input.nonce)) return null;
      if (challenge.address !== input.address || challenge.origin !== input.origin) return null;
      if (challenge.expiresAt.getTime() <= input.now.getTime()) return null;
      consumed.add(input.nonce);
      return challenge;
    },
    async findOrCreateUser(address) {
      let user = users.get(address);
      if (!user) {
        user = { id: `user-${users.size + 1}`, address };
        users.set(address, user);
      }
      return user;
    },
    async createSession(session) {
      sessions.set(session.tokenHash, { userId: session.userId, expiresAt: session.expiresAt, revokedAt: null });
    },
    async findSession(tokenHash, now) {
      const session = sessions.get(tokenHash);
      if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) return null;
      const user = [...users.values()].find((candidate) => candidate.id === session.userId);
      return user ? { user, expiresAt: session.expiresAt } : null;
    },
    async revokeSession(tokenHash, now) {
      const session = sessions.get(tokenHash);
      if (session) session.revokedAt = now;
    },
  };
}

function setup() {
  let currentTime = new Date("2026-11-12T03:00:00.000Z");
  const service = createWalletAuthService(makeRepository(), {
    appOrigin: APP_ORIGIN,
    now: () => currentTime,
  });
  return {
    service,
    setNow(value: string) {
      currentTime = new Date(value);
    },
  };
}

describe("wallet authentication", () => {
  it("challenge_is_bound_to_origin_and_expires", async () => {
    const { service } = setup();
    const challenge = await service.createChallenge(ACCOUNT.address, APP_ORIGIN);

    expect(challenge.message).toContain("URI: http://localhost:3000");
    expect(challenge.message).toContain("Chain ID: 4663");
    expect(challenge.message).toContain(`Nonce: ${challenge.nonce}`);
    expect(challenge.expiresAt).toBe("2026-11-12T03:05:00.000Z");
  });

  it("verify_accepts_valid_signature_once", async () => {
    const { service } = setup();
    const challenge = await service.createChallenge(ACCOUNT.address, APP_ORIGIN);
    const signature = await ACCOUNT.signMessage({ message: challenge.message });
    const result = await service.verifyChallenge({
      address: ACCOUNT.address,
      nonce: challenge.nonce,
      signature,
      origin: APP_ORIGIN,
    });

    expect(result.user.address.toLowerCase()).toBe(ACCOUNT.address.toLowerCase());
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("verify_rejects_expired_or_replayed_nonce", async () => {
    const expired = setup();
    const staleChallenge = await expired.service.createChallenge(ACCOUNT.address, APP_ORIGIN);
    const staleSignature = await ACCOUNT.signMessage({ message: staleChallenge.message });
    expired.setNow("2026-11-12T03:05:01.000Z");

    await expect(
      expired.service.verifyChallenge({
        address: ACCOUNT.address,
        nonce: staleChallenge.nonce,
        signature: staleSignature,
        origin: APP_ORIGIN,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });

    const replayed = setup();
    const challenge = await replayed.service.createChallenge(ACCOUNT.address, APP_ORIGIN);
    const signature = await ACCOUNT.signMessage({ message: challenge.message });
    await replayed.service.verifyChallenge({ address: ACCOUNT.address, nonce: challenge.nonce, signature, origin: APP_ORIGIN });

    await expect(
      replayed.service.verifyChallenge({
        address: ACCOUNT.address,
        nonce: challenge.nonce,
        signature,
        origin: APP_ORIGIN,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
  });

  it("rejects_wrong_origin_and_wrong_signer", async () => {
    const { service } = setup();
    await expect(service.createChallenge(ACCOUNT.address, "https://attacker.example")).rejects.toMatchObject({
      code: "ORIGIN_NOT_ALLOWED",
    });

    const challenge = await service.createChallenge(ACCOUNT.address, APP_ORIGIN);
    const signature = await OTHER_ACCOUNT.signMessage({ message: challenge.message });
    await expect(
      service.verifyChallenge({
        address: ACCOUNT.address,
        nonce: challenge.nonce,
        signature,
        origin: APP_ORIGIN,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });

  it("readSession_rejects_missing_or_expired_session", async () => {
    const { service, setNow } = setup();
    await expect(service.readSession(undefined)).resolves.toBeNull();
    const challenge = await service.createChallenge(ACCOUNT.address, APP_ORIGIN);
    const signature = await ACCOUNT.signMessage({ message: challenge.message });
    const result = await service.verifyChallenge({ address: ACCOUNT.address, nonce: challenge.nonce, signature, origin: APP_ORIGIN });

    await expect(service.readSession(result.sessionToken)).resolves.toMatchObject({ user: { id: result.user.id } });
    setNow("2026-11-19T03:00:01.000Z");
    await expect(service.readSession(result.sessionToken)).resolves.toBeNull();
  });
});
