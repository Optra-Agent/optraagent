import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createAuthHandlers } from "../../lib/auth/handlers";
import { createWalletAuthService } from "../../lib/auth/service";
import type { AuthRepository, AuthenticatedWalletUser, StoredChallenge } from "../../lib/auth/types";

const APP_ORIGIN = "http://localhost:3000";
const ACCOUNT = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

function makeHandlers() {
  const challenges = new Map<string, StoredChallenge>();
  const consumed = new Set<string>();
  const users = new Map<string, AuthenticatedWalletUser>();
  const sessions = new Map<string, { userId: string; expiresAt: Date; revokedAt: Date | null }>();
  const repository: AuthRepository = {
    async createChallenge(challenge) {
      challenges.set(challenge.nonce, challenge);
    },
    async consumeChallenge(input) {
      const challenge = challenges.get(input.nonce);
      if (!challenge || consumed.has(input.nonce) || challenge.address !== input.address || challenge.origin !== input.origin) return null;
      if (challenge.expiresAt.getTime() <= input.now.getTime()) return null;
      consumed.add(input.nonce);
      return challenge;
    },
    async findOrCreateUser(address) {
      const key = address.toLowerCase() as `0x${string}`;
      const user = users.get(key) ?? { id: `user-${users.size + 1}`, address: key };
      users.set(key, user);
      return user;
    },
    async createSession(session) {
      sessions.set(session.tokenHash, { userId: session.userId, expiresAt: session.expiresAt, revokedAt: null });
    },
    async findSession(tokenHash, now) {
      const row = sessions.get(tokenHash);
      if (!row || row.revokedAt || row.expiresAt.getTime() <= now.getTime()) return null;
      const user = [...users.values()].find((candidate) => candidate.id === row.userId);
      return user ? { user, expiresAt: row.expiresAt } : null;
    },
    async revokeSession(tokenHash, now) {
      const row = sessions.get(tokenHash);
      if (row) row.revokedAt = now;
    },
  };
  const service = createWalletAuthService(repository, {
    appOrigin: APP_ORIGIN,
    now: () => new Date("2026-11-12T03:00:00.000Z"),
  });
  return createAuthHandlers(service, { secureCookie: false });
}

describe("wallet auth API handlers", () => {
  it("challenge_requires_the_configured_browser_origin", async () => {
    const handlers = makeHandlers();
    const request = new Request(`${APP_ORIGIN}/api/auth/challenge`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ address: ACCOUNT.address }),
    });

    const response = await handlers.challenge(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("verify_sets_an_http_only_cookie_and_me_requires_it", async () => {
    const handlers = makeHandlers();
    const challengeResponse = await handlers.challenge(new Request(`${APP_ORIGIN}/api/auth/challenge`, {
      method: "POST",
      headers: { origin: APP_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ address: ACCOUNT.address }),
    }));
    const challenge = await challengeResponse.json() as { nonce: string; message: string };
    const signature = await ACCOUNT.signMessage({ message: challenge.message });
    const verifyResponse = await handlers.verify(new Request(`${APP_ORIGIN}/api/auth/verify`, {
      method: "POST",
      headers: { origin: APP_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ address: ACCOUNT.address, nonce: challenge.nonce, signature }),
    }));

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.headers.get("set-cookie")).toContain("HttpOnly");
    expect(verifyResponse.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(await verifyResponse.json()).toMatchObject({ user: { address: ACCOUNT.address.toLowerCase() } });

    const anonymous = await handlers.me(new Request(`${APP_ORIGIN}/api/me`));
    expect(anonymous.status).toBe(401);

    const cookie = verifyResponse.headers.get("set-cookie")!.split(";")[0];
    const authenticated = await handlers.me(new Request(`${APP_ORIGIN}/api/me`, { headers: { cookie } }));
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toMatchObject({ user: { address: ACCOUNT.address.toLowerCase() } });
  });

  it("logout_revokes_the_session_and_clears_the_cookie", async () => {
    const handlers = makeHandlers();
    const challengeResponse = await handlers.challenge(new Request(`${APP_ORIGIN}/api/auth/challenge`, {
      method: "POST",
      headers: { origin: APP_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ address: ACCOUNT.address }),
    }));
    const challenge = await challengeResponse.json() as { nonce: string; message: string };
    const signature = await ACCOUNT.signMessage({ message: challenge.message });
    const verifyResponse = await handlers.verify(new Request(`${APP_ORIGIN}/api/auth/verify`, {
      method: "POST",
      headers: { origin: APP_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ address: ACCOUNT.address, nonce: challenge.nonce, signature }),
    }));
    const cookie = verifyResponse.headers.get("set-cookie")!.split(";")[0];

    const logoutResponse = await handlers.logout(new Request(`${APP_ORIGIN}/api/auth/logout`, { method: "POST", headers: { cookie } }));
    expect(logoutResponse.status).toBe(204);
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await handlers.me(new Request(`${APP_ORIGIN}/api/me`, { headers: { cookie } }))).status).toBe(401);
  });
});
