import { describe, expect, it } from "vitest";
import { getProductionReadinessIssues } from "../../lib/ops/release-readiness";

const readyEnvironment: Record<string, string | undefined> = {
  DATABASE_URL: "postgresql://optra:secret@db.example/optra",
  APP_BASE_URL: "https://paper.optra.example",
  CRON_SECRET: "x".repeat(48),
  LIVE_TRADING_ENABLED: "false",
  V4_CLAIM_LEVEL: "L0",
};

describe("production readiness contract", () => {
  it("accepts PostgreSQL, an HTTPS origin, a strong scheduler secret, and paper-only safety flags", () => {
    expect(getProductionReadinessIssues(readyEnvironment)).toEqual([]);
  });

  it("does not require a scheduler secret while scheduled paper evaluation is disabled", () => {
    const environment = { ...readyEnvironment, CRON_SECRET: undefined };
    expect(getProductionReadinessIssues(environment)).toEqual([]);
    expect(getProductionReadinessIssues({ ...environment, PAPER_CRON_ENABLED: "false" })).toEqual([]);
  });

  it("requires a strong scheduler secret when scheduled paper evaluation is enabled", () => {
    expect(getProductionReadinessIssues({
      ...readyEnvironment,
      PAPER_CRON_ENABLED: "true",
    })).toEqual([]);
    expect(getProductionReadinessIssues({
      ...readyEnvironment,
      CRON_SECRET: "short",
      PAPER_CRON_ENABLED: "true",
    })).toContain("cron_secret_missing_or_weak");
  });

  it("reports missing or unsafe release configuration without exposing values", () => {
    expect(getProductionReadinessIssues({
      DATABASE_URL: "file:local.db",
      APP_BASE_URL: "http://paper.optra.example/path",
      CRON_SECRET: "short",
      PAPER_CRON_ENABLED: "true",
      LIVE_TRADING_ENABLED: "true",
      V4_CLAIM_LEVEL: "L1",
    })).toEqual(expect.arrayContaining([
      "database_url_must_be_postgresql",
      "app_base_url_must_be_https_origin",
      "cron_secret_missing_or_weak",
      "live_trading_must_remain_disabled",
      "v4_claim_level_must_remain_l0",
    ]));
  });
});
