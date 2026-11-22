import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CALLPUT_ROBINHOOD_CONTRACTS } from "../../lib/venue/callput-robinhood-readonly";
import {
  MAINNET_CONTRACTS,
  MAINNET_EXTERNAL_CONTRACTS,
  explorerAddressUrl,
  explorerTxUrl,
} from "../../lib/chain/mainnet-contracts";

const packet = JSON.parse(
  readFileSync("docs/evidence/p4/optra-mainnet-p4-approval-packet-20261121.json", "utf8"),
) as { packet: { chainId: number; transaction: { from: string }; deployment: { predictedHookAddress: string } } };
const receipt = JSON.parse(readFileSync("docs/evidence/p4/deployment-receipt-20261122.json", "utf8")) as {
  status: string;
  transactionHash: string;
  blockNumber: string;
  from: string;
};

describe("official Mainnet contract directory", () => {
  it("lists exactly the approved OptraGuardHook deployment", () => {
    expect(MAINNET_CONTRACTS).toHaveLength(1);
    const [hook] = MAINNET_CONTRACTS;
    expect(hook?.name).toBe("OptraGuardHook");
    expect(packet.packet.chainId).toBe(4663);
    expect(hook?.chainId).toBe(4663);
    expect(hook?.address.toLowerCase()).toBe(packet.packet.deployment.predictedHookAddress.toLowerCase());
    expect(hook?.deployer.toLowerCase()).toBe(packet.packet.transaction.from.toLowerCase());
  });

  it("matches the saved successful receipt", () => {
    const [hook] = MAINNET_CONTRACTS;
    expect(receipt.status).toBe("0x1");
    expect(hook?.deploymentTx).toBe(receipt.transactionHash);
    expect(hook?.block).toBe(Number.parseInt(receipt.blockNumber, 16));
    expect(receipt.from.toLowerCase()).toBe(hook?.deployer.toLowerCase());
  });

  it("builds explorer links and never claims an audit, an exact match or an active pool", () => {
    const [hook] = MAINNET_CONTRACTS;
    expect(explorerAddressUrl(hook!.address)).toBe(`https://robinhoodchain.blockscout.com/address/${hook!.address}`);
    expect(explorerTxUrl(hook!.deploymentTx)).toContain("/tx/0x");
    expect(hook!.operationalStatus).toMatch(/unaudited/i);
    expect(hook!.operationalStatus).toMatch(/uninitialized/i);
    expect(hook!.sourceStatus).toMatch(/partial match/i);
    expect(hook!.sourceStatus).not.toMatch(/fully verified/i);
  });

  it("keeps CallPut's six venue contracts separate from OPTRA-owned contracts and equal to the pinned addresses", () => {
    expect(MAINNET_EXTERNAL_CONTRACTS).toHaveLength(6);
    const optra = new Set(MAINNET_CONTRACTS.map((contract) => contract.address.toLowerCase()));
    const pinned: Record<string, string> = {
      OptionsMarket: CALLPUT_ROBINHOOD_CONTRACTS.optionsMarket,
      PositionManager: CALLPUT_ROBINHOOD_CONTRACTS.positionManager,
      SettleManager: CALLPUT_ROBINHOOD_CONTRACTS.settleManager,
      OptionsAuthority: CALLPUT_ROBINHOOD_CONTRACTS.optionsAuthority,
      Controller: CALLPUT_ROBINHOOD_CONTRACTS.controller,
      TradingAccountFactory: CALLPUT_ROBINHOOD_CONTRACTS.tradingAccountFactory,
    };
    for (const contract of MAINNET_EXTERNAL_CONTRACTS) {
      expect(optra.has(contract.address.toLowerCase())).toBe(false);
      expect(contract.address.toLowerCase()).toBe(pinned[contract.name]?.toLowerCase());
    }
  });
});
