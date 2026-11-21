/**
 * Starts OPTRA's in-process paper scheduler on the Node.js production server. It evaluates paper agents only; set
 * PAPER_SCHEDULER_ENABLED=false to turn it off. It is never started in development or tests, where the suites drive
 * the same scheduler explicitly.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.PAPER_SCHEDULER_ENABLED === "false") return;
  const { startPaperBackgroundScheduler } = await import("./lib/paper/background");
  startPaperBackgroundScheduler();
}
