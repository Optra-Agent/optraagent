import { createHash } from "node:crypto";
import { ROBINHOOD_MAINNET_CAIP2, USDG_ADDRESS_MAINNET, parseUsdgToAtomic } from "@/lib/economics/atomic";
import { OPTRA_VOLATILITY_PROVIDER_ID } from "@/lib/economics/types";
import { verifyX402ExactEvmPayment } from "@/lib/economics/x402-signer";
import type { X402PaymentRequirement } from "@/lib/economics/x402-signer";
import { getMarketHistoryFeed } from "@/lib/market/runtime";
import { rv30ImpliedVolatility } from "@/lib/options/black-scholes";

const PRICE_ATOMIC = parseUsdgToAtomic("0.02");
const PAY_TO = (process.env.X402_TREASURY_ADDRESS ?? "0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848") as `0x${string}`;
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "https://x402.aeron.sh";

function buildRequirement(): X402PaymentRequirement {
  return {
    x402Version: 2,
    scheme: "exact",
    network: ROBINHOOD_MAINNET_CAIP2,
    asset: USDG_ADDRESS_MAINNET,
    amount: PRICE_ATOMIC,
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: {
      name: "Global Dollar",
      version: "1",
    },
  };
}

function encodeBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function computeRegime(iv: number): "LOW_VOL" | "NORMAL_VOL" | "ELEVATED_VOL" | "CRISIS_VOL" {
  if (iv < 0.25) return "LOW_VOL";
  if (iv < 0.45) return "NORMAL_VOL";
  if (iv < 0.70) return "ELEVATED_VOL";
  return "CRISIS_VOL";
}

async function settleWithAeronFacilitator(paymentHeader: string, requirement: X402PaymentRequirement): Promise<{
  ok: boolean;
  txHash: string | null;
  settlementReference: string | null;
  error?: string;
}> {
  const decoded = JSON.parse(Buffer.from(paymentHeader, "base64url").toString("utf8"));
  const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload: decoded, paymentRequirements: requirement }),
  });
  if (!verifyRes.ok) {
    return { ok: false, txHash: null, settlementReference: null, error: `Facilitator verify failed (${verifyRes.status}).` };
  }
  const verifyJson = (await verifyRes.json()) as { isValid?: boolean; invalidReason?: string };
  if (!verifyJson.isValid) {
    return { ok: false, txHash: null, settlementReference: null, error: verifyJson.invalidReason ?? "Facilitator rejected signature." };
  }

  const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload: decoded, paymentRequirements: requirement }),
  });
  if (!settleRes.ok) {
    return { ok: false, txHash: null, settlementReference: null, error: `Facilitator settle failed (${settleRes.status}).` };
  }
  const settleJson = (await settleRes.json()) as { success?: boolean; transaction?: string; errorReason?: string };
  if (!settleJson.success) {
    return { ok: false, txHash: null, settlementReference: null, error: settleJson.errorReason ?? "Facilitator settlement failed." };
  }
  return {
    ok: true,
    txHash: settleJson.transaction ?? null,
    settlementReference: settleJson.transaction ?? null,
  };
}

/**
 * OPTRA-owned x402-protected Volatility & Market Data Oracle.
 * Disclosed as OPTRA_OWNED; backed by real Crius / Robinhood Chain hourly candle history.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("health") === "1") {
    return Response.json({
      ok: true,
      providerId: OPTRA_VOLATILITY_PROVIDER_ID,
      ownership: "OPTRA_OWNED",
      status: "ACTIVE",
      network: ROBINHOOD_MAINNET_CAIP2,
      asset: "USDG",
      facilitator: FACILITATOR_URL,
      liveSettlementEnabled: process.env.X402_FACILITATOR_MODE === "live",
    });
  }

  const symbol = (url.searchParams.get("symbol") ?? "NVDA").toUpperCase();
  const decisionId = url.searchParams.get("decisionId") ?? undefined;
  const requestNonce = url.searchParams.get("requestNonce") ?? undefined;
  const requirement = buildRequirement();

  const paymentHeader = request.headers.get("payment-signature") ?? request.headers.get("x-payment");
  if (!paymentHeader) {
    const paymentRequiredBody = {
      x402Version: 2,
      error: "Payment Required",
      accepts: [requirement],
    };
    return Response.json(paymentRequiredBody, {
      status: 402,
      headers: {
        "payment-required": encodeBase64Url(paymentRequiredBody),
        "cache-control": "no-store",
      },
    });
  }

  const verified = await verifyX402ExactEvmPayment(
    paymentHeader,
    PAY_TO,
    PRICE_ATOMIC,
    USDG_ADDRESS_MAINNET,
    ROBINHOOD_MAINNET_CAIP2,
  );
  if (!verified.valid) {
    return Response.json({ error: verified.reason }, { status: 402, headers: { "cache-control": "no-store" } });
  }

  let settlementMode: "PAPER_REHEARSAL" | "ONCHAIN_SETTLED" = "PAPER_REHEARSAL";
  let txHash: string | null = null;
  let settlementReference: string | null = null;
  const paymentReference = `x402-eip3009-${createHash("sha256").update(verified.payload.payload.signature).digest("hex").slice(0, 16)}`;

  if (process.env.X402_FACILITATOR_MODE === "live") {
    const settled = await settleWithAeronFacilitator(paymentHeader, requirement);
    if (!settled.ok) {
      return Response.json({ error: settled.error ?? "On-chain facilitator settlement failed." }, { status: 402 });
    }
    settlementMode = "ONCHAIN_SETTLED";
    txHash = settled.txHash;
    settlementReference = settled.settlementReference;
  }

  const history = await getMarketHistoryFeed().getHistory(symbol);
  if (!history.candles.length) {
    return Response.json({ error: `No verified candle history available for ${symbol}.` }, { status: 503 });
  }

  const latest = history.candles[history.candles.length - 1]!;
  const latestVol = rv30ImpliedVolatility(history.candles);
  if (!latestVol) {
    return Response.json({ error: `Insufficient hourly candles to compute RV30 for ${symbol}.` }, { status: 503 });
  }
  const { rv30, iv } = latestVol;
  const spotUsd = Number(latest.shareCloseUsd);

  // Compute empirical IV rank proxy over rolling 24h windows in available history.
  const windowVols: number[] = [];
  for (let i = 721; i <= history.candles.length; i += 24) {
    const vol = rv30ImpliedVolatility(history.candles.slice(i - 721, i));
    if (vol) windowVols.push(vol.iv);
  }
  const below = windowVols.filter((v) => v <= iv).length;
  const ivRank = windowVols.length > 0 ? Math.round((below / windowVols.length) * 100) : 50;

  const data = {
    schema: "optra.volatility.v1" as const,
    providerId: OPTRA_VOLATILITY_PROVIDER_ID,
    symbol,
    observedAt: latest.endAt,
    spotUsd,
    realizedVolatility30d: Number(rv30.toFixed(6)),
    impliedVolatility: Number(iv.toFixed(6)),
    ivRank,
    regime: computeRegime(iv),
    source: history.coverage.source,
    sampleCount: history.candles.length,
    ...(requestNonce ? { requestNonce } : {}),
    ...(decisionId ? { decisionId } : {}),
  };

  const receipt = {
    success: true,
    settlementMode,
    paymentReference,
    settlementReference,
    txHash,
    network: ROBINHOOD_MAINNET_CAIP2,
    asset: "USDG",
    amountAtomic: PRICE_ATOMIC,
  };

  return Response.json(
    { data, x402Receipt: receipt },
    {
      status: 200,
      headers: {
        "payment-response": encodeBase64Url(receipt),
        "cache-control": "no-store",
      },
    },
  );
}
