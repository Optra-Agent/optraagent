import { expect, it, vi } from "vitest";
import { runPaperCron } from "../../scripts/railway-paper-cron.mjs";

const secret = "railway-staging-cron-secret-0123456789";
const environment = {
  APP_BASE_URL: "https://optra-staging.example.up.railway.app",
  CRON_SECRET: secret,
  PAPER_CRON_ENABLED: "true",
};

it("posts once to the protected paper endpoint and logs only the safe result summary", async () => {
  const sendRequest = vi.fn().mockResolvedValue({
    statusCode: 200,
    body: JSON.stringify({ status: "complete", agentsConsidered: 2, evaluated: 1, opened: 1, skipped: 0, failures: 0 }),
  });
  const log = vi.fn();

  const result = await runPaperCron({ environment, sendRequest, log });

  expect(result).toBe(0);
  expect(sendRequest).toHaveBeenCalledOnce();
  const request = sendRequest.mock.calls[0]?.[0];
  expect(request?.url.href).toBe("https://optra-staging.example.up.railway.app/api/cron/paper-evaluations");
  expect(request?.method).toBe("POST");
  expect(request?.authorization).toBe(`Bearer ${secret}`);
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "paper_cron.run_completed", opened: 1 }));
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
});

it("does not contact the scheduler unless the paper cron is explicitly enabled", async () => {
  const sendRequest = vi.fn();
  const log = vi.fn();

  const result = await runPaperCron({
    environment: { ...environment, PAPER_CRON_ENABLED: "false" },
    sendRequest,
    log,
  });

  expect(result).toBe(0);
  expect(sendRequest).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "paper_cron.disabled" }));
});

it("rejects a non-HTTPS or non-origin APP_BASE_URL without making a request", async () => {
  const sendRequest = vi.fn();
  const log = vi.fn();

  const result = await runPaperCron({
    environment: { ...environment, APP_BASE_URL: "http://optra-staging.example.up.railway.app/path" },
    sendRequest,
    log,
  });

  expect(result).toBe(1);
  expect(sendRequest).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "paper_cron.configuration_failed" }));
});

it("rejects a missing or short scheduler secret without making a request", async () => {
  const sendRequest = vi.fn();
  const log = vi.fn();

  const result = await runPaperCron({ environment: { ...environment, CRON_SECRET: "short" }, sendRequest, log });

  expect(result).toBe(1);
  expect(sendRequest).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "paper_cron.configuration_failed" }));
});

it("treats an existing advisory-locked run as a safe no-op", async () => {
  const sendRequest = vi.fn().mockResolvedValue({ statusCode: 202, body: JSON.stringify({ status: "already_running" }) });
  const log = vi.fn();

  const result = await runPaperCron({ environment, sendRequest, log });

  expect(result).toBe(0);
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "paper_cron.overlap_skipped" }));
});

it("fails visibly when the scheduler reports a partial run", async () => {
  const sendRequest = vi.fn().mockResolvedValue({
    statusCode: 200,
    body: JSON.stringify({ status: "partial", agentsConsidered: 2, evaluated: 1, opened: 0, skipped: 1, failures: 1 }),
  });
  const log = vi.fn();

  const result = await runPaperCron({ environment, sendRequest, log });

  expect(result).toBe(1);
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "paper_cron.run_partial", failures: 1 }));
});

it.each([
  { statusCode: 401, body: JSON.stringify({ error: { code: "UNAUTHORIZED" } }) },
  { statusCode: 503, body: JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE" } }) },
  { statusCode: 200, body: "not-json" },
  { statusCode: 200, body: "null" },
])("returns failure for unsuccessful or malformed endpoint responses", async (response) => {
  const sendRequest = vi.fn().mockResolvedValue(response);
  const log = vi.fn();

  const result = await runPaperCron({ environment, sendRequest, log });

  expect(result).toBe(1);
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "paper_cron.request_failed" }));
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
});

it("returns failure without exposing the credential when the HTTPS request rejects", async () => {
  const sendRequest = vi.fn().mockRejectedValue(new Error(`request failed with ${secret}`));
  const log = vi.fn();

  const result = await runPaperCron({ environment, sendRequest, log });

  expect(result).toBe(1);
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "paper_cron.request_failed" }));
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
});

it("does not reflect an upstream error field that matches the scheduler credential", async () => {
  const sendRequest = vi.fn().mockResolvedValue({
    statusCode: 503,
    body: JSON.stringify({ error: { code: secret } }),
  });
  const log = vi.fn();

  const result = await runPaperCron({ environment, sendRequest, log });

  expect(result).toBe(1);
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
});
