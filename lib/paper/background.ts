import { runEnsureHouseAgents } from "../house/runtime";
import { getPaperScheduler } from "./runtime";

const INTERVAL_MS = 10 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 90 * 1000;
const blockedUntil = new Map<string, number>();

type BackgroundGlobal = typeof globalThis & { __optraPaperBackground?: { timer: NodeJS.Timeout } };

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[DATABASE_URL]").slice(0, 240) : "Unknown failure.";
}

/**
 * One background pass: make sure the public House Agents exist and are launched, then evaluate every running paper
 * agent's finalized candles. Paper evaluation only: it has no access to, and never calls, any live-trading path.
 * Overlapping passes (a redeploy, two instances) are harmless: the evaluation holds a PostgreSQL advisory lock and
 * every decision is idempotent per candle.
 */
export async function runPaperBackgroundPass(): Promise<void> {
  try {
    const outcomes = await runEnsureHouseAgents({ blockedUntil });
    console.info(JSON.stringify({ event: "house_agents.ensure_completed", agents: outcomes.map(({ key, status }) => ({ key, status })) }));
  } catch (cause) {
    console.error(JSON.stringify({ event: "house_agents.ensure_failed", message: describe(cause) }));
  }
  try {
    const response = await (await getPaperScheduler()).runInProcess();
    if (response.status >= 500) console.error(JSON.stringify({ event: "paper_background.pass_partial", status: response.status }));
  } catch (cause) {
    console.error(JSON.stringify({ event: "paper_background.pass_failed", message: describe(cause) }));
  }
}

export function startPaperBackgroundScheduler(): void {
  const scope = globalThis as BackgroundGlobal;
  if (scope.__optraPaperBackground) return;
  const schedule = (delay: number): NodeJS.Timeout => {
    const timer = setTimeout(() => {
      void runPaperBackgroundPass().finally(() => {
        if (scope.__optraPaperBackground) scope.__optraPaperBackground.timer = schedule(INTERVAL_MS);
      });
    }, delay);
    timer.unref();
    return timer;
  };
  scope.__optraPaperBackground = { timer: schedule(FIRST_RUN_DELAY_MS) };
  console.info(JSON.stringify({ event: "paper_background.started", intervalMs: INTERVAL_MS }));
}
