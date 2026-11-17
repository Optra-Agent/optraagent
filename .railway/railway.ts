import { defineRailway, github, postgres, project, service } from "railway/iac";

const repository = "Optra-Agent/optraagent";
const releaseBranch = "main";

export default defineRailway((context) => {
  const database = postgres("OPTRA PostgreSQL");
  const appBaseUrl = context.shared.APP_BASE_URL;
  const cronSecret = context.shared.CRON_SECRET;
  const cronSchedule = process.env.OPTRA_ENABLE_PAPER_CRON === "true" ? "*/15 * * * *" : null;

  const web = service("OPTRA Web", {
    source: github(repository, { branch: releaseBranch }),
    env: {
      APP_BASE_URL: appBaseUrl,
      CRON_SECRET: cronSecret,
      DATABASE_URL: database.env.DATABASE_URL,
      LIVE_TRADING_ENABLED: "false",
      NODE_ENV: "production",
      PORT: "3000",
      V4_CLAIM_LEVEL: "L0",
    },
    healthcheck: "/api/health/ready",
    healthcheckTimeout: 300,
    replicas: 1,
  });

  const paperCron = service("OPTRA Paper Cron", {
    source: github(repository, { branch: releaseBranch }),
    start: "node scripts/railway-paper-cron.mjs",
    deploy: {
      cronSchedule,
      restartPolicyType: "NEVER",
    },
    env: {
      APP_BASE_URL: appBaseUrl,
      CRON_SECRET: cronSecret,
      LIVE_TRADING_ENABLED: "false",
      NODE_ENV: "production",
      PAPER_CRON_ENABLED: cronSchedule ? "true" : "false",
      V4_CLAIM_LEVEL: "L0",
    },
  });

  return project("OPTRA Staging", {
    resources: [database, web, paperCron],
  });
});
