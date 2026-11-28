"use client";

import { useCallback, useEffect, useState } from "react";

type HarmonicState = {
  binding: {
    harmonicRegistryId: string | null;
    harmonicIdentity: string | null;
    registrationStatus: string;
    registeredAt: string | null;
    lastError: string | null;
  } | null;
  policy: {
    harmonicRequiredBeforeExecution: boolean;
    filingMode: "PUBLIC_OPEN" | "SEALED" | "DISABLED";
    onHarmonicUnavailable: string;
    requireProofBeforeActivation: boolean;
  };
  expectations: Array<{
    id: string;
    decisionId: string;
    filingMode: string;
    status: string;
    underlying: string;
    direction: string;
    horizon: string;
    harmonicReference: string | null;
    externalUrl: string | null;
    recipeHash: string;
    strategyMandateHash: string;
    createdAt: string;
  }>;
  grades: Array<{
    id: string;
    decisionId: string;
    ruleCompliance: string;
    expectationOutcome: string;
    harmonicReference: string | null;
    gradedAt: string;
  }>;
  proofs: Array<{
    id: string;
    status: string;
    kernelName: string;
    kernelHash: string;
    recipeHash: string;
    codeVersion: string;
    properties: Array<{ id: string; description: string; status: string }>;
    assumptions: string[];
    externalReference: string | null;
    requestedAt: string;
  }>;
  tapeEvents: Array<{
    id: string;
    eventType: string;
    status: string;
    reason: string;
    harmonicReference: string | null;
    createdAt: string;
  }>;
};

export function AgentVerificationSection({
  agentId,
  agentName,
  mode = "user",
}: {
  agentId: string;
  agentName: string;
  mode?: "user" | "house";
}) {
  const [data, setData] = useState<HarmonicState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiBase =
    mode === "house"
      ? `/api/house/${agentId}/harmonic`
      : `/api/agents/${agentId}/harmonic`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiBase, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as HarmonicState;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load verification state");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    fetch(apiBase, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as HarmonicState;
      })
      .then((json) => {
        if (active) {
          setData(json);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load verification state");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiBase]);

  const runAction = async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Action ${action} failed`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 text-sm text-zinc-400">
        Loading Harmonic verification state...
      </div>
    );
  }

  const binding = data?.binding;
  const latestProof = data?.proofs?.[0];
  const latestExpectation = data?.expectations?.[0];
  const latestGrade = data?.grades?.[0];
  const isRegistered = binding?.registrationStatus === "REGISTERED";

  return (
    <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-zinc-100">
            Harmonic Agent Verification &amp; Registry
          </h3>
          <p className="text-xs text-zinc-400">
            Pre-action expectations, sealed commitments, and machine-verified critical boundaries.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isRegistered && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void runAction("register", { name: agentName })}
              className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {busy === "register" ? "Registering..." : "Register on Harmonic"}
            </button>
          )}
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void runAction("verify")}
            className="rounded-lg bg-sky-500/20 px-3 py-1.5 text-xs font-medium text-sky-300 ring-1 ring-sky-500/40 hover:bg-sky-500/30 disabled:opacity-50"
          >
            {busy === "verify" ? "Verifying..." : "Verify Critical Kernels"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Harmonic Agent</div>
          <div className="mt-1 text-sm font-medium text-zinc-100">
            {isRegistered ? "Connected" : "Not Connected"}
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-400">
            {binding?.harmonicIdentity ?? "Unregistered"}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Filing Mode</div>
          <div className="mt-1 text-sm font-medium text-zinc-100">
            {data?.policy.filingMode ?? "PUBLIC_OPEN"}
          </div>
          <div className="mt-0.5 text-xs text-zinc-400">
            {latestExpectation
              ? `Last: ${latestExpectation.status} (${latestExpectation.underlying})`
              : "No expectations filed yet"}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Latest Grade</div>
          <div className="mt-1 text-sm font-medium text-zinc-100">
            {latestGrade ? latestGrade.expectationOutcome : "NONE"}
          </div>
          <div className="mt-0.5 text-xs text-zinc-400">
            {latestGrade ? `Rules: ${latestGrade.ruleCompliance}` : "Awaiting graded action"}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Proof Status</div>
          <div className="mt-1 text-sm font-medium text-zinc-100">
            {latestProof ? latestProof.status : "NOT REQUESTED"}
          </div>
          <div className="mt-0.5 text-xs text-zinc-400">
            {latestProof?.status === "PROVED"
              ? "Property proved"
              : latestProof?.status === "STALE"
                ? "Proof stale after code/config change"
                : latestProof?.status === "REFUTED"
                  ? "Property refuted"
                  : "Verification not yet run"}
          </div>
        </div>
      </div>

      {latestProof && (
        <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-zinc-200">
              Verified Kernel: {latestProof.kernelName} ({latestProof.codeVersion})
            </span>
            <span className="font-mono text-[11px] text-zinc-400">
              {latestProof.kernelHash.slice(0, 22)}...
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {latestProof.properties.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-zinc-300">
                <span>
                  <strong className="text-zinc-100">{p.id}</strong>: {p.description}
                </span>
                <span
                  className={
                    p.status === "PROVED" ? "text-emerald-400" : "text-rose-400"
                  }
                >
                  {p.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {latestExpectation?.harmonicReference && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-4 py-2.5 text-xs">
          <span className="text-zinc-300">
            External Harmonic Reference:{" "}
            <code className="font-mono text-emerald-300">
              {latestExpectation.harmonicReference}
            </code>
          </span>
          {latestExpectation.externalUrl && (
            <a
              href={latestExpectation.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 hover:underline"
            >
              Inspect on Harmonic Registry →
            </a>
          )}
        </div>
      )}
    </section>
  );
}
