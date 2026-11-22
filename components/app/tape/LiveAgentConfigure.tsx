"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { LIVE_AGENT_HARD_CAPS } from "@/lib/venue/callput-live-agent-limits";

type AgentChoice = { id: string; name: string; kind: "house" | "yours"; symbol: string | null };
type Props = {
  /** The address the CallPut factory would give this wallet's first Account, or null when it could not be read. */
  tradingAddress: string | null;
  accountUsable: boolean | null;
  onProposed: () => void;
};

const STRATEGIES = ["BuyPutSpread", "BuyCallSpread", "SellPutSpread", "SellCallSpread"] as const;
const UNDERLYINGS = ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "QQQ", "SPY"] as const;
const HARD = {
  perOrder: Number(LIVE_AGENT_HARD_CAPS.maxCollateralPerOrderRaw) / 1e6,
  open: Number(LIVE_AGENT_HARD_CAPS.maxOpenCollateralRaw) / 1e6,
  daily: Number(LIVE_AGENT_HARD_CAPS.maxDailyCollateralRaw) / 1e6,
  orders: LIVE_AGENT_HARD_CAPS.maxOrdersPerDay,
  lifetimeDays: LIVE_AGENT_HARD_CAPS.maxGrantLifetimeMs / 86_400_000,
};
const raw = (usd: number) => String(Math.round(usd * 1e6));
const MAX_EXECUTION_FEE_WEI = "300000000000000";

/** Configure and validate a scoped grant, then propose it. A proposal cannot trade: the grant stays inactive until the evidence exists. */
export function LiveAgentConfigure({ tradingAddress, accountUsable, onProposed }: Props) {
  const [choices, setChoices] = useState<AgentChoice[]>([]);
  const [agentId, setAgentId] = useState("");
  const [underlying, setUnderlying] = useState<string>("NVDA");
  const [strategy, setStrategy] = useState<(typeof STRATEGIES)[number]>("BuyPutSpread");
  const [perOrder, setPerOrder] = useState("5");
  const [openCap, setOpenCap] = useState("10");
  const [dailyCap, setDailyCap] = useState("10");
  const [ordersPerDay, setOrdersPerDay] = useState("1");
  const [minDays, setMinDays] = useState("3");
  const [maxDays, setMaxDays] = useState("14");
  const [lifetimeDays, setLifetimeDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled([
      fetch("/api/public/v1/agents", { cache: "no-store", signal: controller.signal }).then((r) => r.json()),
      fetch("/api/agents", { credentials: "include", cache: "no-store", signal: controller.signal }).then((r) => r.json()),
    ]).then(([house, mine]) => {
      const out: AgentChoice[] = [];
      const take = (value: unknown, kind: AgentChoice["kind"]) => {
        const list = (value as { agents?: Array<Record<string, unknown>> } | null)?.agents;
        for (const agent of Array.isArray(list) ? list : []) {
          if (typeof agent.id === "string" && typeof agent.name === "string") out.push({ id: agent.id, name: agent.name, kind, symbol: typeof agent.underlyingSymbol === "string" ? agent.underlyingSymbol : null });
        }
      };
      if (house.status === "fulfilled") take(house.value, "house");
      if (mine.status === "fulfilled") take(mine.value, "yours");
      if (!controller.signal.aborted) setChoices(out);
    });
    return () => controller.abort();
  }, []);

  const problems = useMemo(() => {
    const list: string[] = [];
    const n = (value: string) => Number(value);
    if (!agentId) list.push("Choose the Paper agent this grant is for.");
    if (!tradingAddress) list.push("The CallPut Account address could not be read, so there is nothing to scope the grant to.");
    if (!(n(perOrder) > 0 && n(perOrder) <= HARD.perOrder)) list.push(`Per-order collateral must be between 0 and ${HARD.perOrder} USDG.`);
    if (!(n(openCap) > 0 && n(openCap) <= HARD.open)) list.push(`Open collateral must be between 0 and ${HARD.open} USDG.`);
    if (!(n(dailyCap) > 0 && n(dailyCap) <= HARD.daily)) list.push(`Daily collateral must be between 0 and ${HARD.daily} USDG.`);
    if (n(perOrder) > n(openCap)) list.push("Per-order collateral cannot exceed the open-collateral cap.");
    if (!(Number.isInteger(n(ordersPerDay)) && n(ordersPerDay) >= 1 && n(ordersPerDay) <= HARD.orders)) list.push(`Orders per day must be a whole number from 1 to ${HARD.orders}.`);
    if (!(n(minDays) >= 1 && n(maxDays) <= 365 && n(minDays) <= n(maxDays))) list.push("Expiry window must run from at least 1 day to at most 365, minimum not above maximum.");
    if (!(n(lifetimeDays) >= 1 && n(lifetimeDays) <= HARD.lifetimeDays)) list.push(`Grant lifetime must be 1 to ${HARD.lifetimeDays} days.`);
    return list;
  }, [agentId, tradingAddress, perOrder, openCap, dailyCap, ordersPerDay, minDays, maxDays, lifetimeDays]);

  async function propose() {
    if (problems.length > 0 || !tradingAddress) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/venue/callput/live-agent/grants", {
        method: "POST", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId, route: "callput-account", tradingAddress, expiresAtMs: Date.now() + Number(lifetimeDays) * 86_400_000,
          policy: {
            allowedUnderlyings: [underlying], allowedStrategies: [strategy],
            maxCollateralPerOrderRaw: raw(Number(perOrder)), maxOpenCollateralRaw: raw(Number(openCap)), maxDailyCollateralRaw: raw(Number(dailyCap)),
            maxOrdersPerDay: Number(ordersPerDay), maxPendingRequests: 1, maxExecutionFeeWei: MAX_EXECUTION_FEE_WEI,
            minExpiryDays: Number(minDays), maxExpiryDays: Number(maxDays),
          },
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string }; grant?: { missingEvidence?: string[] } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "The grant could not be proposed.");
      setMessage(`Proposed. It cannot trade yet: ${body?.grant?.missingEvidence?.length ?? 5} evidence items are missing, and an on-chain session grant signed by you is still needed.`);
      onProposed();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The grant could not be proposed.");
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string, label: string, value: string, set: (value: string) => void, hint?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(event) => { set(event.target.value); setMessage(""); }} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );

  return (
    <details className="gate-evidence">
      <summary>Configure a live agent grant</summary>
      <div className="mt-3 grid gap-4">
        <ol className="gate-evidence" aria-label="Launch path">
          <li>1. Connect wallet: done.</li>
          <li>2. Configure and validate: below, checked against the engine&apos;s hard caps.</li>
          <li>3. Authorize session: {accountUsable === false ? "blocked, CallPut's account factory would refuse an open for this Account today (see the account gates note above)." : accountUsable === true ? "needs an on-chain session grant signed by you." : "account status not read."}</li>
          <li>4. Launch, evaluate, execute: closed until all seven gates pass and a grant is active.</li>
        </ol>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="live-agent-choice">Paper agent</Label>
            <NativeSelect id="live-agent-choice" value={agentId} onChange={(event) => { setAgentId(event.target.value); const symbol = choices.find((c) => c.id === event.target.value)?.symbol; if (symbol && (UNDERLYINGS as readonly string[]).includes(symbol)) setUnderlying(symbol); setMessage(""); }}>
              <option value="">Choose an agent</option>
              {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name} ({choice.kind === "house" ? "House" : "yours"})</option>)}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="live-agent-underlying">Underlying</Label>
            <NativeSelect id="live-agent-underlying" value={underlying} onChange={(event) => setUnderlying(event.target.value)}>
              {UNDERLYINGS.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="live-agent-strategy">Structure</Label>
            <NativeSelect id="live-agent-strategy" value={strategy} onChange={(event) => setStrategy(event.target.value as (typeof STRATEGIES)[number])}>
              {STRATEGIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">Only Protective Put maps to a structure (BuyPutSpread). The other three House Agents have no CallPut structure yet.</p>
          </div>
          {field("live-agent-per-order", "Max collateral per order (USDG)", perOrder, setPerOrder, `Hard cap ${HARD.perOrder}.`)}
          {field("live-agent-open", "Max open collateral (USDG)", openCap, setOpenCap, `Hard cap ${HARD.open}.`)}
          {field("live-agent-daily", "Max collateral per day (USDG)", dailyCap, setDailyCap, `Hard cap ${HARD.daily}.`)}
          {field("live-agent-orders", "Orders per day", ordersPerDay, setOrdersPerDay, `Hard cap ${HARD.orders}.`)}
          {field("live-agent-min-days", "Minimum days to expiry", minDays, setMinDays)}
          {field("live-agent-max-days", "Maximum days to expiry", maxDays, setMaxDays)}
          {field("live-agent-lifetime", "Grant lifetime (days)", lifetimeDays, setLifetimeDays, `Hard cap ${HARD.lifetimeDays}.`)}
        </div>
        <p className="text-xs text-muted-foreground">Scoped to {tradingAddress ?? "an unread account address"} only. OPTRA would only ever request opens under this grant; closing and settling stay with your own wallet. You can revoke it at any time.</p>
        {problems.length > 0 ? <ul className="gate-evidence" aria-label="Validation"><li>{problems[0]}</li>{problems.length > 1 ? <li>and {problems.length - 1} more.</li> : null}</ul> : <p className="ack-done" role="status">Validated against the hard caps.</p>}
        <div className="ack-actions">
          <Button type="button" disabled={problems.length > 0 || busy} onClick={() => void propose()}>{busy ? "Proposing…" : "Propose grant"}</Button>
        </div>
        {message ? <p className="ack-done" role="status">{message}</p> : null}
        {error ? <p role="alert" className="form-error">{error}</p> : null}
      </div>
    </details>
  );
}
