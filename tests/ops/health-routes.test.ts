import { afterEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../lib/db/client", () => ({ getDatabase: async () => ({ execute }) }));

import { GET as live } from "../../app/api/health/live/route";
import { GET as ready } from "../../app/api/health/ready/route";

describe("health routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    execute.mockReset();
  });

  it("keeps liveness independent of database and release configuration", async () => {
    const response = live();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails readiness closed for unsafe release configuration and checks PostgreSQL when configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("APP_BASE_URL", "http://paper.example");
    vi.stubEnv("CRON_SECRET", "short");
    vi.stubEnv("LIVE_TRADING_ENABLED", "true");
    vi.stubEnv("V4_CLAIM_LEVEL", "L1");
    const unsafe = await ready();
    expect(unsafe.status).toBe(503);
    await expect(unsafe.json()).resolves.toMatchObject({ status: "not_ready", issues: expect.arrayContaining(["database_url_missing", "live_trading_must_remain_disabled"]) });
    expect(execute).not.toHaveBeenCalled();

    vi.stubEnv("DATABASE_URL", "postgresql://app:secret@db.example/optra");
    vi.stubEnv("APP_BASE_URL", "https://paper.example");
    vi.stubEnv("CRON_SECRET", "x".repeat(40));
    vi.stubEnv("LIVE_TRADING_ENABLED", "false");
    vi.stubEnv("V4_CLAIM_LEVEL", "L0");
    execute.mockResolvedValueOnce({ rows: [{ result: 1 }] });
    const healthy = await ready();
    expect(healthy.status).toBe(200);
    await expect(healthy.json()).resolves.toEqual({ status: "ready", checks: { database: "ok" } });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
