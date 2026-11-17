import { describe, expect, it } from "vitest";
import { createDatabase } from "../../lib/db/client";

type SchedulerLock = { release: () => Promise<void> };
type LockableConnection = Awaited<ReturnType<typeof createDatabase>> & {
  acquirePaperSchedulerLock?: () => Promise<SchedulerLock | null>;
};

const databaseUrl = process.env.OPTRA_TEST_POSTGRES_URL;

describe.skipIf(!databaseUrl)("PostgreSQL scheduled-worker lease", () => {
  it("prevents overlap across independent PostgreSQL connections and releases for retry", async () => {
    const first = await createDatabase({ databaseUrl, nodeEnv: "test" }) as LockableConnection;
    const second = await createDatabase({ databaseUrl, nodeEnv: "test" }) as LockableConnection;
    try {
      expect(first.acquirePaperSchedulerLock).toBeTypeOf("function");
      expect(second.acquirePaperSchedulerLock).toBeTypeOf("function");
      const firstLease = await first.acquirePaperSchedulerLock!();
      expect(firstLease).not.toBeNull();
      const overlappingLease = await second.acquirePaperSchedulerLock!();
      expect(overlappingLease).toBeNull();

      await firstLease!.release();
      const retryLease = await second.acquirePaperSchedulerLock!();
      expect(retryLease).not.toBeNull();
      await retryLease!.release();
    } finally {
      await first.close();
      await second.close();
    }
  });
});
