"use client";

import { useEffect, useState } from "react";
import { formatAtomicToUsdg, parseUsdgToAtomic } from "../../../lib/economics/atomic";
import type {
  EconomicGlobalControls,
  EconomicMandate,
  ServiceCategory,
  ServiceProvider,
  X402PaymentRecordView,
  X402TapeEventRecord,
} from "../../../lib/economics/types";
import { explorerTxUrl } from "../../../lib/chain/mainnet-contracts";
import { formatUtc, shortHash } from "../format";
import { Chip, Panel, StateBlock } from "../ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type EconomicAccountDto = {
  id: string;
  agentId: string;
  serviceBalanceAtomic: string;
  totalFundedAtomic: string;
  totalSpentAtomic: string;
  spentTodayAtomic: string;
  remainingTodayAtomic: string;
  spendDayUtc: string;
  requestsThisHour: number;
  mandate: EconomicMandate;
  mandateHash: string;
  mandateVersion: number;
  machineSpendingStatus: "ACTIVE" | "PAUSED" | "EXHAUSTED";
  updatedAt: string;
};

type EconomicsPayload = {
  account: EconomicAccountDto;
  providers: ServiceProvider[];
  payments: X402PaymentRecordView[];
  tapeEvents: X402TapeEventRecord[];
  globalControls: EconomicGlobalControls;
};

const ALL_CATEGORIES: ServiceCategory[] = [
  "VOLATILITY_DATA",
  "MARKET_DATA",
  "PRICING",
  "VERIFICATION",
  "RESEARCH",
  "EXECUTION_SUPPORT",
  "TRANSACTION_REHEARSAL",
];

function statusTone(status: string): "azure" | "ember" | "neutral" | "loss" | "gain" {
  if (status === "ACTIVE" || status === "RECONCILED" || status === "SETTLED" || status === "VALIDATED" || status === "X402_PAYMENT_SETTLED" || status === "RESOURCE_VALIDATED") return "gain";
  if (status === "DENIED" || status === "REJECTED" || status === "X402_PAYMENT_DENIED" || status === "RESOURCE_REJECTED" || status === "EXHAUSTED") return "loss";
  if (status === "AUTHORIZED" || status === "X402_PAYMENT_AUTHORIZED" || status === "RESOURCE_REQUIRED" || status === "SERVICE_QUOTED") return "ember";
  return "neutral";
}

export function AgentEconomicsSection({
  agentId,
  mode,
}: {
  agentId: string;
  mode: "owner" | "public";
}) {
  const [data, setData] = useState<EconomicsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fundAmount, setFundAmount] = useState("1.00");
  const [dailyBudgetInput, setDailyBudgetInput] = useState("1.00");
  const [perRequestInput, setPerRequestInput] = useState("0.10");
  const [saveMessage, setSaveMessage] = useState("");
  const [reloadCount, setReloadCount] = useState(0);

  const endpoint = mode === "public"
    ? `/api/house/${encodeURIComponent(agentId)}/economics`
    : `/api/agents/${encodeURIComponent(agentId)}/economics`;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Unable to load agent economics.");
        return (await res.json()) as EconomicsPayload;
      })
      .then((payload) => {
        setData(payload);
        setDailyBudgetInput(formatAtomicToUsdg(payload.account.mandate.dailyServiceBudgetAtomic, 2));
        setPerRequestInput(formatAtomicToUsdg(payload.account.mandate.perRequestLimitAtomic, 2));
        setError("");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Unable to load agent economics.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, reloadCount]);

  async function postAction(body: unknown, message: string) {
    setBusy(true);
    setSaveMessage("");
    setError("");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/economics`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) throw new Error(json?.error?.message ?? "Economic update failed.");
      setSaveMessage(message);
      setReloadCount((c) => c + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Economic update failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <StateBlock kind="loading" title="Loading x402 economics…" />;
  if (error && !data) return <StateBlock kind="error" title="Economics unavailable"><p>{error}</p></StateBlock>;
  if (!data) return null;

  const { account, providers, payments, tapeEvents, globalControls } = data;
  const globalKillActive =
    globalControls.emergencyDenyAllMachinePayments ||
    globalControls.pauseMachineServiceSpending ||
    globalControls.disableX402Globally;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="panel-head">
          <div>
            <p className="eyebrow">X402 ECONOMIC AUTONOMY · ISOLATED SERVICE BUDGET</p>
            <h2>Machine Spending &amp; Mandate</h2>
          </div>
          <div className="flex items-center gap-2">
            {globalKillActive ? <Chip tone="loss">GLOBAL KILL SWITCH</Chip> : null}
            <Chip tone={statusTone(account.machineSpendingStatus)}>
              {account.machineSpendingStatus}
            </Chip>
          </div>
        </div>

        <dl className="kv">
          <div>
            <dt>Service Budget Balance</dt>
            <dd className="mono">{formatAtomicToUsdg(account.serviceBalanceAtomic, 4)} USDG</dd>
          </div>
          <div>
            <dt>Spent Today (UTC)</dt>
            <dd className="mono">{formatAtomicToUsdg(account.spentTodayAtomic, 4)} USDG</dd>
          </div>
          <div>
            <dt>Remaining Today</dt>
            <dd className="mono">
              {formatAtomicToUsdg(account.remainingTodayAtomic, 4)} / {formatAtomicToUsdg(account.mandate.dailyServiceBudgetAtomic, 2)} USDG
            </dd>
          </div>
          <div>
            <dt>Per-Request Limit</dt>
            <dd className="mono">{formatAtomicToUsdg(account.mandate.perRequestLimitAtomic, 2)} USDG</dd>
          </div>
          <div>
            <dt>Mandate Hash (v{account.mandateVersion})</dt>
            <dd className="mono" title={account.mandateHash}>{shortHash(account.mandateHash, 14, 6)}</dd>
          </div>
          <div>
            <dt>Trading Capital Isolation</dt>
            <dd className="mono">ENFORCED (allowTradingCapitalForServices = false)</dd>
          </div>
          <div className="kv-wide">
            <dt>Approved Categories</dt>
            <dd className="hook-chips">
              {account.mandate.approvedServiceCategories.map((cat) => (
                <span className="hook-chip" key={cat}>{cat}</span>
              ))}
            </dd>
          </div>
          <div className="kv-wide">
            <dt>Approved Providers</dt>
            <dd className="space-y-1">
              {providers.map((p) => {
                const approved = account.mandate.approvedProviders.includes(p.id);
                return (
                  <div key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <Chip tone={approved ? "azure" : "neutral"}>{approved ? "APPROVED" : "NOT APPROVED"}</Chip>
                    <span className="font-medium">{p.name}</span>
                    <span className="mono text-muted-foreground">({p.id} · {p.ownership} · {p.network})</span>
                  </div>
                );
              })}
            </dd>
          </div>
        </dl>

        {mode === "owner" ? (
          <div className="mt-4 grid gap-4 border-t border-border/60 pt-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fund-service-budget">Fund Isolated Service Budget (USDG)</Label>
              <div className="flex gap-2">
                <Input
                  id="fund-service-budget"
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  placeholder="1.00"
                />
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void postAction(
                      { action: "fund", amountUsdg: fundAmount },
                      `Funded ${fundAmount} USDG to isolated Service Budget.`,
                    )
                  }
                >
                  Fund Budget
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Update Limits &amp; Machine Spending</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label="Daily service budget USDG"
                  className="w-28"
                  value={dailyBudgetInput}
                  onChange={(e) => setDailyBudgetInput(e.target.value)}
                />
                <Input
                  aria-label="Per-request limit USDG"
                  className="w-28"
                  value={perRequestInput}
                  onChange={(e) => setPerRequestInput(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void postAction(
                      {
                        action: "update_mandate",
                        mandate: {
                          ...account.mandate,
                          dailyServiceBudgetAtomic: parseUsdgToAtomic(dailyBudgetInput),
                          perRequestLimitAtomic: parseUsdgToAtomic(perRequestInput),
                        },
                      },
                      "Updated daily and per-request limits.",
                    )
                  }
                >
                  Save Caps
                </Button>
                <Button
                  type="button"
                  variant={account.mandate.enabled ? "outline" : "default"}
                  disabled={busy}
                  onClick={() =>
                    void postAction(
                      {
                        action: "update_mandate",
                        mandate: { ...account.mandate, enabled: !account.mandate.enabled },
                      },
                      account.mandate.enabled ? "Machine spending paused." : "Machine spending enabled.",
                    )
                  }
                >
                  {account.mandate.enabled ? "Pause Spending" : "Enable Spending"}
                </Button>
              </div>
            </div>

            <div className="md:col-span-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Toggle categories:</span>
              {ALL_CATEGORIES.map((cat) => {
                const active = account.mandate.approvedServiceCategories.includes(cat);
                return (
                  <Button
                    key={cat}
                    type="button"
                    size="sm"
                    variant={active ? "secondary" : "outline"}
                    disabled={busy}
                    onClick={() => {
                      const next = active
                        ? account.mandate.approvedServiceCategories.filter((c) => c !== cat)
                        : [...account.mandate.approvedServiceCategories, cat];
                      void postAction(
                        { action: "update_mandate", mandate: { ...account.mandate, approvedServiceCategories: next } },
                        `Updated category ${cat}.`,
                      );
                    }}
                  >
                    {cat}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : null}

        {saveMessage ? <p className="mt-3 text-xs text-emerald-400">{saveMessage}</p> : null}
        {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
      </Panel>

      <Panel>
        <div className="panel-head">
          <h2>x402 Payment History</h2>
          <span className="coverage-sub">{payments.length} record(s)</span>
        </div>
        {payments.length === 0 ? (
          <p className="empty-line">No x402 machine payments recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Decision ID</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reference / Tx</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="mono text-xs">{formatUtc(p.createdAt)}</TableCell>
                  <TableCell className="mono text-xs" title={p.decisionId}>{shortHash(p.decisionId, 12, 6)}</TableCell>
                  <TableCell className="text-xs">
                    {p.providerId}
                    <span className="cell-sub">{p.serviceCategory} · {p.settlementMode}</span>
                  </TableCell>
                  <TableCell className="mono text-xs">{formatAtomicToUsdg(p.amountAtomic, 4)} {p.asset}</TableCell>
                  <TableCell>
                    <Chip tone={statusTone(p.status)}>{p.status}</Chip>
                    <span className="cell-sub">{p.reasonCode} · {p.validationStatus}</span>
                  </TableCell>
                  <TableCell className="mono text-xs">
                    {p.txHash ? (
                      <a href={explorerTxUrl(p.txHash)} target="_blank" rel="noreferrer" className="underline">
                        {shortHash(p.txHash, 10, 6)}
                      </a>
                    ) : (
                      <span>{p.paymentReference ?? "—"}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <div className="panel-head">
          <h2>Economic Decision Trace</h2>
          <span className="coverage-sub">{tapeEvents.length} event(s)</span>
        </div>
        {tapeEvents.length === 0 ? (
          <p className="empty-line">No x402 lifecycle events recorded yet.</p>
        ) : (
          <ol className="space-y-2 text-xs">
            {tapeEvents.map((ev) => (
              <li key={ev.id} className="rounded-md border border-border/60 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Chip tone={statusTone(ev.eventType)}>{ev.eventType}</Chip>
                    {ev.providerId ? <span className="mono">{ev.providerId}</span> : null}
                    {ev.amountAtomic ? <span className="mono">{formatAtomicToUsdg(ev.amountAtomic, 4)} {ev.asset ?? "USDG"}</span> : null}
                  </div>
                  <time className="mono text-muted-foreground">{formatUtc(ev.createdAt)}</time>
                </div>
                <p className="mt-1 text-muted-foreground">{ev.reason}</p>
                <p className="mt-1 mono text-[11px] text-muted-foreground">
                  Decision {shortHash(ev.decisionId, 12, 6)} · Mandate {shortHash(ev.economicMandateHash, 10, 6)}
                  {ev.paymentReference ? ` · Ref ${ev.paymentReference}` : ""}
                  {ev.txHash ? (
                    <>
                      {" · "}
                      <a href={explorerTxUrl(ev.txHash)} target="_blank" rel="noreferrer" className="underline">
                        Tx {shortHash(ev.txHash, 10, 6)}
                      </a>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
