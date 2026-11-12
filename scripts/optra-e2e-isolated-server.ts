import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
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
const stopServer = () => {
  if (stopping) return;
  stopping = true;
  activeChild?.kill("SIGTERM");
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

const serverExitCode = await runBun(
  ["run", "dev", "--hostname", hostname, "--port", String(port)],
  `Starting isolated Next.js on ${hostname}:${port}`,
  { ...process.env, OPTRA_E2E_DIST_DIR: ".local/optra-next-e2e" },
);
process.exitCode = serverExitCode;
