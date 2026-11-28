import { randomBytes } from "node:crypto";
import { getAddress, verifyTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ROBINHOOD_MAINNET_CAIP2, USDG_ADDRESS_MAINNET } from "./atomic";

export type X402PaymentRequirement = {
  x402Version: 2;
  scheme: "exact";
  network: string;
  asset: `0x${string}`;
  amount: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
  };
};

export type Eip3009Authorization = {
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
};

export type X402PaymentPayload = {
  x402Version: 2;
  scheme: "exact";
  network: string;
  accepted: X402PaymentRequirement;
  payload: {
    signature: `0x${string}`;
    authorization: Eip3009Authorization;
  };
};

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

let cachedEphemeralRehearsalKey: `0x${string}` | null = null;

function getIsolatedSignerKey(): { key: `0x${string}`; isEphemeralRehearsal: boolean } {
  const configured = process.env.X402_SIGNER_PRIVATE_KEY?.trim();
  if (configured && /^0x[0-9a-fA-F]{64}$/.test(configured)) {
    return { key: configured as `0x${string}`, isEphemeralRehearsal: false };
  }
  if (!cachedEphemeralRehearsalKey) {
    cachedEphemeralRehearsalKey = generatePrivateKey();
  }
  return { key: cachedEphemeralRehearsalKey, isEphemeralRehearsal: true };
}

function parseChainId(network: string): number {
  const parts = network.split(":");
  const id = Number(parts[1] ?? "4663");
  return Number.isFinite(id) && id > 0 ? id : 4663;
}

/**
 * Signs an EIP-3009 TransferWithAuthorization payload for x402 v2 using an isolated signer.
 * Never exposes private keys to LLM prompts or strategy code.
 */
export async function signX402ExactEvmPayment(
  requirement: X402PaymentRequirement,
  now = new Date(),
): Promise<{ headerValue: string; payload: X402PaymentPayload; signerAddress: `0x${string}`; isEphemeralRehearsal: boolean }> {
  const { key, isEphemeralRehearsal } = getIsolatedSignerKey();
  const account = privateKeyToAccount(key);
  const nowSec = Math.floor(now.getTime() / 1000);
  const validAfter = (nowSec - 60).toString();
  const validBefore = (nowSec + requirement.maxTimeoutSeconds).toString();
  const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const chainId = parseChainId(requirement.network || ROBINHOOD_MAINNET_CAIP2);

  const authorization: Eip3009Authorization = {
    from: getAddress(account.address),
    to: getAddress(requirement.payTo),
    value: requirement.amount,
    validAfter,
    validBefore,
    nonce,
  };

  const signature = await account.signTypedData({
    domain: {
      name: requirement.extra.name || "Global Dollar",
      version: requirement.extra.version || "1",
      chainId,
      verifyingContract: getAddress(requirement.asset || USDG_ADDRESS_MAINNET),
    },
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  const payload: X402PaymentPayload = {
    x402Version: 2,
    scheme: "exact",
    network: requirement.network,
    accepted: requirement,
    payload: {
      signature,
      authorization,
    },
  };

  const headerValue = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { headerValue, payload, signerAddress: account.address, isEphemeralRehearsal };
}

export async function verifyX402ExactEvmPayment(
  headerValue: string,
  expectedPayTo: `0x${string}`,
  expectedAmount: string,
  expectedAsset: `0x${string}` = USDG_ADDRESS_MAINNET,
  expectedNetwork: string = ROBINHOOD_MAINNET_CAIP2,
): Promise<{ valid: true; payload: X402PaymentPayload } | { valid: false; reason: string }> {
  let decoded: X402PaymentPayload;
  try {
    const raw = Buffer.from(headerValue, "base64url").toString("utf8");
    decoded = JSON.parse(raw) as X402PaymentPayload;
  } catch {
    return { valid: false, reason: "Malformed PAYMENT-SIGNATURE header." };
  }

  if (decoded?.x402Version !== 2 || decoded.scheme !== "exact" || !decoded.payload?.authorization || !decoded.payload?.signature) {
    return { valid: false, reason: "Unsupported x402 payment payload." };
  }

  const auth = decoded.payload.authorization;
  if (auth.to.toLowerCase() !== expectedPayTo.toLowerCase()) {
    return { valid: false, reason: "Payment recipient mismatch." };
  }
  if (BigInt(auth.value) < BigInt(expectedAmount)) {
    return { valid: false, reason: "Payment amount is below the required quote." };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Number(auth.validBefore) < nowSec) {
    return { valid: false, reason: "Payment authorization has expired." };
  }

  const chainId = parseChainId(expectedNetwork);
  const ok = await verifyTypedData({
    address: getAddress(auth.from),
    domain: {
      name: decoded.accepted?.extra?.name || "Global Dollar",
      version: decoded.accepted?.extra?.version || "1",
      chainId,
      verifyingContract: getAddress(expectedAsset),
    },
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: getAddress(auth.from),
      to: getAddress(auth.to),
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
    signature: decoded.payload.signature,
  });

  if (!ok) {
    return { valid: false, reason: "Invalid EIP-3009 TransferWithAuthorization signature." };
  }

  return { valid: true, payload: decoded };
}
