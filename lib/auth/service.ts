import { createHash, randomBytes } from "node:crypto";
import { isAddress, recoverMessageAddress } from "viem";
import type { AuthenticatedWalletUser, AuthRepository, WalletAuthOptions, VerifyWalletChallenge } from "./types";
import { AuthServiceError } from "./types";

const DEFAULT_NONCE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeAddress(address: string): `0x${string}` {
  if (!isAddress(address)) {
    throw new AuthServiceError("INVALID_ADDRESS", "A valid EVM wallet address is required.");
  }
  return address.toLowerCase() as `0x${string}`;
}

function normalizeOrigin(origin: string, appOrigin: string): string {
  let parsed: URL;
  let expected: URL;
  try {
    parsed = new URL(origin);
    expected = new URL(appOrigin);
  } catch {
    throw new AuthServiceError("ORIGIN_NOT_ALLOWED", "The request origin is not allowed.");
  }

  const validProtocol = parsed.protocol === "https:" || parsed.protocol === "http:";
  if (!validProtocol || parsed.origin !== origin || parsed.origin !== expected.origin) {
    throw new AuthServiceError("ORIGIN_NOT_ALLOWED", "The request origin is not allowed.");
  }
  return parsed.origin;
}

function buildMessage(origin: string, nonce: string, issuedAt: Date, expiresAt: Date): string {
  const domain = new URL(origin).host;
  return [
    `${domain} wants you to sign in to Optra.`,
    "This signature is free and does not authorize a transaction.",
    "",
    `URI: ${origin}`,
    "Version: 1",
    "Chain ID: 4663",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join("\n");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function createWalletAuthService(repository: AuthRepository, options: WalletAuthOptions) {
  const appOrigin = new URL(options.appOrigin).origin;
  const now = options.now ?? (() => new Date());
  const nonceTtlMs = options.nonceTtlMs ?? DEFAULT_NONCE_TTL_MS;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;

  return {
    async createChallenge(addressInput: string, requestOrigin: string) {
      const address = normalizeAddress(addressInput);
      const origin = normalizeOrigin(requestOrigin, appOrigin);
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + nonceTtlMs);
      const nonce = randomBytes(16).toString("hex");
      const message = buildMessage(origin, nonce, issuedAt, expiresAt);

      await repository.createChallenge({ nonce, address, origin, message, expiresAt });
      return { nonce, message, expiresAt: expiresAt.toISOString() };
    },

    async verifyChallenge(input: VerifyWalletChallenge) {
      const address = normalizeAddress(input.address);
      const origin = normalizeOrigin(input.origin, appOrigin);
      const currentTime = now();
      const challenge = await repository.consumeChallenge({ nonce: input.nonce, address, origin, now: currentTime });
      if (!challenge || challenge.expiresAt.getTime() <= currentTime.getTime()) {
        throw new AuthServiceError("INVALID_CHALLENGE", "The wallet challenge is invalid or expired.");
      }

      let recovered: string;
      try {
        recovered = await recoverMessageAddress({ message: challenge.message, signature: input.signature });
      } catch {
        throw new AuthServiceError("INVALID_SIGNATURE", "The wallet signature could not be verified.");
      }
      if (normalizeAddress(recovered) !== address) {
        throw new AuthServiceError("INVALID_SIGNATURE", "The wallet signature does not match this address.");
      }

      const user = await repository.findOrCreateUser(address);
      const sessionToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(currentTime.getTime() + sessionTtlMs);
      await repository.createSession({
        tokenHash: hashToken(sessionToken),
        userId: user.id,
        expiresAt,
        createdAt: currentTime,
      });
      return { user, sessionToken, expiresAt: expiresAt.toISOString() };
    },

    async readSession(sessionToken: string | undefined): Promise<{ user: AuthenticatedWalletUser; expiresAt: string } | null> {
      if (!sessionToken || !isSessionToken(sessionToken)) return null;
      const session = await repository.findSession(hashToken(sessionToken), now());
      return session ? { user: session.user, expiresAt: session.expiresAt.toISOString() } : null;
    },

    async revokeSession(sessionToken: string | undefined): Promise<void> {
      if (!sessionToken || !isSessionToken(sessionToken)) return;
      await repository.revokeSession(hashToken(sessionToken), now());
    },
  };
}
