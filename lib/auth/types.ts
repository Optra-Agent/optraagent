import type { Hex } from "viem";

export type AuthenticatedWalletUser = {
  id: string;
  address: `0x${string}`;
};

export type StoredChallenge = {
  nonce: string;
  address: `0x${string}`;
  origin: string;
  message: string;
  expiresAt: Date;
};

export type StoredSession = {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
};

export interface AuthRepository {
  createChallenge(challenge: StoredChallenge): Promise<void>;
  consumeChallenge(input: {
    nonce: string;
    address: `0x${string}`;
    origin: string;
    now: Date;
  }): Promise<StoredChallenge | null>;
  findOrCreateUser(address: `0x${string}`): Promise<AuthenticatedWalletUser>;
  createSession(session: StoredSession): Promise<void>;
  findSession(tokenHash: string, now: Date): Promise<{ user: AuthenticatedWalletUser; expiresAt: Date } | null>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
}

export type VerifyWalletChallenge = {
  address: string;
  nonce: string;
  signature: Hex;
  origin: string;
};

export type WalletAuthOptions = {
  appOrigin: string;
  now?: () => Date;
  nonceTtlMs?: number;
  sessionTtlMs?: number;
};

export class AuthServiceError extends Error {
  constructor(
    readonly code: "INVALID_ADDRESS" | "ORIGIN_NOT_ALLOWED" | "INVALID_CHALLENGE" | "INVALID_SIGNATURE",
    message: string,
  ) {
    super(message);
    this.name = "AuthServiceError";
  }
}
