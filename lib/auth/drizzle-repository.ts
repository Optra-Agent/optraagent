import { and, eq, gt, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { authChallenges, schema, sessions, users } from "../../db/schema";
import type { AuthRepository, StoredChallenge, StoredSession } from "./types";

type AuthDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export class DrizzleAuthRepository implements AuthRepository {
  constructor(private readonly db: AuthDb) {}

  async createChallenge(challenge: StoredChallenge): Promise<void> {
    await this.db.insert(authChallenges).values({
      nonce: challenge.nonce,
      address: challenge.address.toLowerCase(),
      origin: challenge.origin,
      message: challenge.message,
      expiresAt: challenge.expiresAt,
    });
  }

  async consumeChallenge(input: {
    nonce: string;
    address: `0x${string}`;
    origin: string;
    now: Date;
  }): Promise<StoredChallenge | null> {
    const [challenge] = await this.db.update(authChallenges)
      .set({ consumedAt: input.now })
      .where(and(
        eq(authChallenges.nonce, input.nonce),
        eq(authChallenges.address, input.address.toLowerCase()),
        eq(authChallenges.origin, input.origin),
        gt(authChallenges.expiresAt, input.now),
        isNull(authChallenges.consumedAt),
      ))
      .returning({
        nonce: authChallenges.nonce,
        address: authChallenges.address,
        origin: authChallenges.origin,
        message: authChallenges.message,
        expiresAt: authChallenges.expiresAt,
      });

    return challenge ? { ...challenge, address: challenge.address as `0x${string}` } : null;
  }

  async findOrCreateUser(address: `0x${string}`) {
    const normalizedAddress = address.toLowerCase();
    const [inserted] = await this.db.insert(users)
      .values({ address: normalizedAddress })
      .onConflictDoNothing({ target: users.address })
      .returning({ id: users.id, address: users.address });
    const user = inserted ?? (await this.db.select({ id: users.id, address: users.address })
      .from(users)
      .where(eq(users.address, normalizedAddress)))[0];

    if (!user) throw new Error("Unable to load authenticated wallet owner.");
    return { id: user.id, address: user.address as `0x${string}` };
  }

  async createSession(session: StoredSession): Promise<void> {
    await this.db.insert(sessions).values({
      tokenHash: session.tokenHash,
      userId: session.userId,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    });
  }

  async findSession(tokenHash: string, now: Date) {
    const [session] = await this.db.select({
      expiresAt: sessions.expiresAt,
      id: users.id,
      address: users.address,
    })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ))
      .limit(1);

    return session
      ? { user: { id: session.id, address: session.address as `0x${string}` }, expiresAt: session.expiresAt }
      : null;
  }

  async revokeSession(tokenHash: string, now: Date): Promise<void> {
    await this.db.update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
  }
}
