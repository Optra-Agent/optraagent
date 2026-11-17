import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;
const MAX_RESPONSE_BYTES = 64 * 1024;

function emit(log, entry) {
  try {
    log({ timestamp: new Date().toISOString(), ...entry });
  } catch {
    // Logging must not change the scheduler request result.
  }
}

function readConfiguration(environment) {
  const configuredOrigin = environment.APP_BASE_URL?.trim();
  if (!configuredOrigin) return { error: "app_base_url_missing" };

  let origin;
  try {
    origin = new URL(configuredOrigin);
  } catch {
    return { error: "app_base_url_invalid" };
  }

  const normalizedOrigin = configuredOrigin.replace(/\/$/, "");
  if (
    origin.protocol !== "https:" ||
    origin.origin !== normalizedOrigin ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  ) {
    return { error: "app_base_url_must_be_https_origin" };
  }

  const secret = environment.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) return { error: "cron_secret_missing_or_weak" };

  return {
    url: new URL("/api/cron/paper-evaluations", origin),
    secret,
  };
}

function requestPaperEvaluation({ url, authorization, timeoutMs }) {
  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpsRequest(url, {
      method: "POST",
      agent: false,
      headers: {
        accept: "application/json",
        authorization,
        "content-length": "0",
      },
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      let responseBytes = 0;
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        responseBytes += Buffer.byteLength(chunk);
        if (responseBytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error("response_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolveResponse({ statusCode: response.statusCode ?? 0, body: chunks.join("") });
      });
      response.on("error", rejectResponse);
    });

    request.on("timeout", () => request.destroy(new Error("request_timeout")));
    request.on("error", rejectResponse);
    request.end();
  });
}

function count(summary, key) {
  const value = summary[key];
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Invoke the protected Railway staging endpoint once and return a process exit code.
 * @param {{ environment?: Record<string, string | undefined>, sendRequest?: (request: { url: URL, method: string, authorization: string, timeoutMs: number }) => Promise<{ statusCode: number, body: string }>, log?: (entry: Record<string, string | number>) => void }} options
 */
export async function runPaperCron({
  environment = process.env,
  sendRequest = requestPaperEvaluation,
  log = (entry) => console.log(JSON.stringify(entry)),
} = {}) {
  if (environment.PAPER_CRON_ENABLED !== "true") {
    emit(log, { event: "paper_cron.disabled", reason: "explicit_enablement_required" });
    return 0;
  }

  const configuration = readConfiguration(environment);
  if ("error" in configuration) {
    emit(log, { event: "paper_cron.configuration_failed", reason: configuration.error });
    return 1;
  }

  let response;
  try {
    response = await sendRequest({
      url: configuration.url,
      method: "POST",
      authorization: `Bearer ${configuration.secret}`,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch {
    emit(log, { event: "paper_cron.request_failed", reason: "scheduler_transport_error" });
    return 1;
  }

  let result;
  try {
    result = JSON.parse(response.body);
  } catch {
    emit(log, { event: "paper_cron.request_failed", reason: "scheduler_response_invalid_json", httpStatus: response.statusCode });
    return 1;
  }

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    emit(log, { event: "paper_cron.request_failed", reason: "scheduler_response_invalid_shape", httpStatus: response.statusCode });
    return 1;
  }

  if (response.statusCode === 202 && result.status === "already_running") {
    emit(log, { event: "paper_cron.overlap_skipped", httpStatus: response.statusCode });
    return 0;
  }

  if (response.statusCode !== 200) {
    emit(log, { event: "paper_cron.request_failed", reason: "scheduler_http_error", httpStatus: response.statusCode });
    return 1;
  }

  const summary = {
    agentsConsidered: count(result, "agentsConsidered"),
    evaluated: count(result, "evaluated"),
    opened: count(result, "opened"),
    skipped: count(result, "skipped"),
    duplicates: count(result, "duplicates"),
    deferred: count(result, "deferred"),
    failures: count(result, "failures"),
  };

  if (result.status !== "complete" || summary.failures > 0) {
    emit(log, { event: "paper_cron.run_partial", ...summary });
    return 1;
  }

  emit(log, { event: "paper_cron.run_completed", ...summary });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runPaperCron();
}
