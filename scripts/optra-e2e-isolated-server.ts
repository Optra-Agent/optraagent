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

const fixture = JSON.parse(await readFile(path.join(snapshotRoot, "tests/fixtures/aapl-crius-hourly-capture.json"), "utf8")) as {
  capturedAt: string;
  asset: unknown;
  quote: unknown;
  candles: unknown;
  corpActions: unknown[];
};
const marketFixtureServer = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", `http://${hostname}`).pathname;
  let body: unknown;
  if (pathname === "/rhj/assets") body = { assets: [fixture.asset] };
  else if (pathname === "/rhj/prices/AAPL") body = fixture.quote;
  else if (pathname === "/rhj/corporate-actions") body = { corpActions: fixture.corpActions };
  else if (pathname.endsWith("/candles")) body = fixture.candles;
  else {
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
    PGLITE_DATA_DIR: ".local/optra-db",
    APP_BASE_URL: `http://${hostname}:${port}`,
    OPTRA_MARKET_ROBINHOOD_BASE_URL: marketFixtureBaseUrl,
    OPTRA_MARKET_CRIUS_BASE_URL: `${marketFixtureBaseUrl}/v1/robinhood/token`,
    OPTRA_E2E_MARKET_AS_OF: fixture.capturedAt,
    OPTRA_E2E_DIST_DIR: ".local/optra-next-e2e",
  },
);
closeMarketFixtureServer?.();
process.exitCode = serverExitCode;
