export function getProductionReadinessIssues(environment: Record<string, string | undefined>): string[] {
  const issues: string[] = [];
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    issues.push("database_url_missing");
  } else {
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") issues.push("database_url_must_be_postgresql");
    } catch {
      issues.push("database_url_invalid");
    }
  }

  const appBaseUrl = environment.APP_BASE_URL?.trim();
  try {
    if (!appBaseUrl) throw new Error("missing");
    const parsed = new URL(appBaseUrl);
    if (parsed.protocol !== "https:" || parsed.origin !== appBaseUrl.replace(/\/$/, "") || parsed.username || parsed.password || parsed.search || parsed.hash) {
      issues.push("app_base_url_must_be_https_origin");
    }
  } catch {
    issues.push("app_base_url_invalid");
  }

  if (environment.PAPER_CRON_ENABLED === "true" && (environment.CRON_SECRET?.trim().length ?? 0) < 32) {
    issues.push("cron_secret_missing_or_weak");
  }
  if (environment.LIVE_TRADING_ENABLED !== "false") issues.push("live_trading_must_remain_disabled");
  if (environment.V4_CLAIM_LEVEL !== "L0") issues.push("v4_claim_level_must_remain_l0");
  return issues;
}
