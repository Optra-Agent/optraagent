"use client";

import { useRef, useState, type FormEvent } from "react";
import { usePublicClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  CALLPUT_ROBINHOOD_CHAIN_ID,
} from "@/lib/venue/callput-robinhood-readonly";
import {
  readCallPutRobinhoodRequest,
  type CallPutRobinhoodRequestKind,
  type CallPutRobinhoodRequestSnapshot,
  type CallPutRobinhoodRequestStatus,
} from "@/lib/venue/callput-robinhood-requests";
import { formatUtc } from "../format";
import { Chip, Panel } from "../ui";

function statusTone(status: CallPutRobinhoodRequestStatus): "neutral" | "azure" | "ember" | "gain" {
  if (status === "Pending") return "azure";
  if (status === "Cancelled") return "ember";
  if (status === "Executed") return "gain";
  return "neutral";
}

function rawValue(value: bigint | null): string {
  return value === null ? "Not returned" : value.toString();
}

function formatTimestamp(value: bigint | null): string {
  if (value === null || value === 0n) return "Not returned";
  return formatUtc(new Date(Number(value) * 1_000).toISOString());
}

function errorMessage(reason: unknown): string {
  if (!(reason instanceof Error)) return "CallPut request could not be read.";
  return reason.message.replace(/https?:\/\/[^\s)]+/gi, "[RPC endpoint]") || "CallPut request could not be read.";
}

function EvidenceRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mono break-all text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RequestEvidence({ request }: { request: CallPutRobinhoodRequestSnapshot }) {
  if (request.status === "Not found") {
    return (
      <div className="grid gap-3 border-t border-border pt-4" aria-live="polite">
        <div className="panel-head">
          <h3>Request evidence</h3>
          <Chip>{request.status}</Chip>
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          No request record found for this key on Robinhood Mainnet.
        </p>
      </div>
    );
  }

  const requestRows: Array<[string, string]> = [
    ["Request key", request.requestKey],
    ["Venue account", request.account ?? "Not returned"],
    ["Underlying asset index", request.underlyingAssetIndex?.toString() ?? "Not returned"],
    ["Expiry (UTC)", formatTimestamp(request.expiry)],
    ["Option token ID (raw)", rawValue(request.optionTokenId)],
    ["Submitted at (UTC)", formatTimestamp(request.submittedAt)],
    ["Native-token flag (semantics unconfirmed)", request.nativeTokenHandling === null ? "Not returned" : String(request.nativeTokenHandling)],
  ];
  const termRows: Array<[string, string]> = request.kind === "open"
    ? [
      ["Amount in (raw value)", rawValue(request.amountIn)],
      ["Minimum size (raw value)", rawValue(request.minSize)],
      ["Minimum swap output (raw value)", rawValue(request.minOutWhenSwap)],
    ]
    : [
      ["Size (raw value)", rawValue(request.size)],
      ["Minimum amount out (raw value)", rawValue(request.minAmountOut)],
      ["Minimum swap output (raw value)", rawValue(request.minOutWhenSwap)],
    ];
  const executionRows: Array<[string, string]> = request.kind === "open"
    ? [
      ["Size out (raw value)", rawValue(request.sizeOut)],
      ["Amount out (raw value)", rawValue(request.amountOut)],
      ["Execution price (raw value)", rawValue(request.executionPrice)],
      ["Processed at (UTC)", formatTimestamp(request.processedAt)],
    ]
    : [
      ["Amount out (raw value)", rawValue(request.amountOut)],
      ["Execution price (raw value)", rawValue(request.executionPrice)],
      ["Processed at (UTC)", formatTimestamp(request.processedAt)],
    ];

  return (
    <div className="grid gap-4 border-t border-border pt-4" aria-live="polite">
      <div className="panel-head">
        <h3>Request evidence</h3>
        <Chip tone={statusTone(request.status)}>{request.status}</Chip>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {request.status === "Pending" ? "Pending request. No fill is claimed from this status." : null}
        {request.status === "Cancelled" ? "Cancelled request. No fill is reported." : null}
        {request.status === "Executed" ? "Executed per the CallPut request getter. The displayed raw fields are not separate settlement confirmation." : null}
      </p>
      <div className="grid gap-2">
        <h4 className="text-sm font-semibold">Request record</h4>
        <EvidenceRows rows={requestRows} />
      </div>
      <div className="grid gap-2">
        <h4 className="text-sm font-semibold">Request terms · raw venue values</h4>
        <EvidenceRows rows={termRows} />
      </div>
      {request.status === "Executed" ? (
        <div className="grid gap-2">
          <h4 className="text-sm font-semibold">Execution fields · raw venue values</h4>
          <EvidenceRows rows={executionRows} />
        </div>
      ) : null}
    </div>
  );
}

export function CallPutRequestTracker() {
  const publicClient = usePublicClient({ chainId: CALLPUT_ROBINHOOD_CHAIN_ID });
  const requestSequence = useRef(0);
  const [requestKey, setRequestKey] = useState("");
  const [kind, setKind] = useState<CallPutRobinhoodRequestKind>("open");
  const [request, setRequest] = useState<CallPutRobinhoodRequestSnapshot | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function readRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sequence = ++requestSequence.current;
    setRequest(null);
    setError("");
    if (!publicClient) {
      setError("No Robinhood Mainnet public read client is available.");
      return;
    }

    setIsLoading(true);
    try {
      const result = await readCallPutRobinhoodRequest(publicClient, kind, requestKey);
      if (requestSequence.current === sequence) setRequest(result);
    } catch (reason) {
      if (requestSequence.current === sequence) setError(errorMessage(reason));
    } finally {
      if (requestSequence.current === sequence) setIsLoading(false);
    }
  }

  return (
    <Panel aria-label="CallPut request tracker" className="mb-5 p-5 sm:p-6">
      <div className="panel-head">
        <div>
          <h2>CallPut request tracker</h2>
          <p className="coverage-sub">Read-only · Robinhood Mainnet · chain {CALLPUT_ROBINHOOD_CHAIN_ID}</p>
        </div>
        <Chip>Venue data</Chip>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Look up an open or close request by its bytes32 key. This manual read is separate from Paper and does not create a Paper fill.
      </p>
      <form onSubmit={readRequest} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <div className="grid gap-1.5">
          <label htmlFor="callput-request-key" className="text-sm font-medium">Request key (bytes32)</label>
          <Input
            id="callput-request-key"
            value={requestKey}
            onChange={(event) => {
              requestSequence.current += 1;
              setRequestKey(event.target.value);
              setError("");
              setRequest(null);
              setIsLoading(false);
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            aria-describedby="callput-request-key-help"
            aria-invalid={error.startsWith("CallPut request key") ? true : undefined}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="callput-request-kind" className="text-sm font-medium">Request type</label>
          <NativeSelect
            id="callput-request-kind"
            value={kind}
            onChange={(event) => {
              requestSequence.current += 1;
              setKind(event.target.value as CallPutRobinhoodRequestKind);
              setError("");
              setRequest(null);
              setIsLoading(false);
            }}
          >
            <option value="open">Open</option>
            <option value="close">Close</option>
          </NativeSelect>
        </div>
        <Button type="submit" disabled={!publicClient || isLoading}>
          {isLoading ? "Reading…" : request ? "Refresh request" : "Read request"}
        </Button>
      </form>
      <p id="callput-request-key-help" className="mt-2 text-xs text-muted-foreground">
        Manual refresh only. Amounts are shown as raw values because CallPut unit scales remain unconfirmed.
      </p>
      {!publicClient ? <p role="status" className="mt-3 text-sm text-muted-foreground">No Robinhood Mainnet read client is configured.</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-[var(--ember-text)]">{error}</p> : null}
      {request ? <RequestEvidence request={request} /> : null}
    </Panel>
  );
}
