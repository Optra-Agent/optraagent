import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = process.cwd();
const hostname = "127.0.0.1";
const port = Number(process.env.OPTRA_E2E_PORT ?? "3100");
const reservedPorts = [3000, 3001, 3002];

if (!Number.isInteger(port) || port < 1024 || port > 65535 || reservedPorts.includes(port)) {
  throw new Error("OPTRA_E2E_PORT must be an unused, non-SENTERA port between 1024 and 65535.");
}

const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "optra-e2e-"));
const excludedEntries = new Set([
  ".git",
  ".local",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);

await cp(projectRoot, snapshotRoot, {
  recursive: true,
  filter(source) {
    const relativePath = path.relative(projectRoot, source);
    if (relativePath === "") return true;

    const firstEntry = relativePath.split(path.sep, 1)[0];
    const basename = path.basename(source);
    if (excludedEntries.has(firstEntry)) return false;
    if (basename.startsWith(".env") && basename !== ".env.example") return false;
    return true;
  },
});

console.log(`[optra-e2e] Isolated source snapshot: ${snapshotRoot}`);

let stopping = false;
let activeChild: ChildProcess | null = null;
let closeMarketFixtureServer: (() => void) | null = null;
const stopServer = () => {
  if (stopping) return;
  stopping = true;
  activeChild?.kill("SIGTERM");
  closeMarketFixtureServer?.();
};

process.on("SIGINT", stopServer);
process.on("SIGTERM", stopServer);

function runBun(args: string[], label: string, env = process.env): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: snapshotRoot,
      env,
      stdio: "inherit",
    });
    activeChild = child;
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      activeChild = null;
      if (signal === "SIGTERM" && stopping) resolve(0);
      else if (code === 0) resolve(0);
      else resolve(code ?? 1);
    });
    console.log(`[optra-e2e] ${label}`);
  });
}

const installExitCode = await runBun(["install", "--frozen-lockfile", "--no-save", "--no-progress"], "Installing locked dependencies in the snapshot");
if (stopping) process.exit(0);
if (installExitCode !== 0) {
  console.error(`[optra-e2e] Dependency installation failed with exit code ${installExitCode}.`);
  process.exit(installExitCode);
}

type HouseCapture = {
  capturedAt: string;
  assets: Array<{ tokenSymbol: string; deployments: Array<{ chainId: number; contractAddress: string }> }>;
  quotes: Record<string, unknown>;
  candles: Record<string, unknown>;
  earnings: Record<string, unknown>;
  corpActions: unknown[];
};

// OPTRA_E2E_FIXTURE=house serves the archived multi-symbol capture (NVDA, TSLA, MSFT) including Robinhood's earnings
// calendar, so the House Agent journeys run against the real application backend with real recorded market data.
const houseMode = process.env.OPTRA_E2E_FIXTURE === "house";
const fixture = JSON.parse(await readFile(path.join(snapshotRoot, houseMode ? "tests/fixtures/market-capture-20261121.json" : "tests/fixtures/aapl-crius-hourly-capture.json"), "utf8")) as {
  capturedAt: string;
  asset?: unknown;
  quote?: unknown;
  candles: unknown;
  corpActions: unknown[];
} & Partial<HouseCapture>;
const marketFixtureServer = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${hostname}`);
  const pathname = url.pathname;
  let body: unknown;
  if (houseMode) {
    const capture = fixture as unknown as HouseCapture;
    const priced = /^\/rhj\/prices\/([A-Z.]+)$/.exec(pathname);
    const candled = /^\/v1\/robinhood\/token\/(0x[0-9a-fA-F]{40})\/candles$/.exec(pathname);
    if (pathname === "/rhj/assets") body = { assets: capture.assets };
    else if (priced) body = capture.quotes[priced[1]!];
    else if (pathname === "/rhj/corporate-actions") body = { corpActions: capture.corpActions };
    else if (pathname === "/marketdata/earnings/" || pathname === "/marketdata/earnings") body = capture.earnings[url.searchParams.get("symbol") ?? ""];
    else if (candled) {
      const symbol = capture.assets.find((asset) => asset.deployments.some((deployment) => deployment.contractAddress.toLowerCase() === candled[1]!.toLowerCase()))?.tokenSymbol;
      body = symbol ? capture.candles[symbol] : undefined;
    }
  } else if (pathname === "/rhj/assets") body = { assets: [fixture.asset] };
  else if (pathname === "/rhj/prices/AAPL") body = fixture.quote;
  else if (pathname === "/rhj/corporate-actions") body = { corpActions: fixture.corpActions };
  else if (pathname.endsWith("/candles")) body = fixture.candles;
  if (body === undefined) {
    response.writeHead(404, { "cache-control": "no-store" });
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
});
await new Promise<void>((resolve, reject) => {
  marketFixtureServer.once("error", reject);
  marketFixtureServer.listen(0, hostname, resolve);
});
const marketFixtureAddress = marketFixtureServer.address();
if (!marketFixtureAddress || typeof marketFixtureAddress === "string") {
  throw new Error("The isolated market fixture server did not bind to a TCP port.");
}
closeMarketFixtureServer = () => {
  if (marketFixtureServer.listening) marketFixtureServer.close();
};
const marketFixtureBaseUrl = `http://${hostname}:${marketFixtureAddress.port}`;

const serverExitCode = await runBun(
  ["run", "dev", "--hostname", hostname, "--port", String(port)],
  `Starting isolated Next.js on ${hostname}:${port}`,
  {
    ...process.env,
    DATABASE_URL: undefined,
    PGLITE_DATA_DIR: houseMode ? ".local/optra-db-house" : ".local/optra-db",
    APP_BASE_URL: `http://${hostname}:${port}`,
    OPTRA_MARKET_ROBINHOOD_BASE_URL: marketFixtureBaseUrl,
    OPTRA_MARKET_CRIUS_BASE_URL: `${marketFixtureBaseUrl}/v1/robinhood/token`,
    OPTRA_E2E_MARKET_AS_OF: fixture.capturedAt,
    OPTRA_E2E_DIST_DIR: houseMode ? ".local/optra-next-e2e-house" : ".local/optra-next-e2e",
    // The house-agent suite drives the three strategy agents by hand; the background scheduler must not race it.
    PAPER_SCHEDULER_ENABLED: "false",
  },
);
closeMarketFixtureServer?.();
process.exitCode = serverExitCode;
