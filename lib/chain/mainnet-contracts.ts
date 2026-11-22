// Official OPTRA contract directory for Robinhood Chain Mainnet (chain 4663).
// OPTRA-owned contracts and external third-party contracts are kept in separate lists on purpose: OPTRA does not own,
// operate, audit or control anything in MAINNET_EXTERNAL_CONTRACTS.
// Source of truth for OPTRA-owned entries: docs/evidence/p4/mainnet-deployment-record-20261122.md. Add an entry only
// after the receipt, runtime code and constructor state are confirmed on chain.
export const MAINNET_CHAIN_ID = 4663;
export const MAINNET_EXPLORER = "https://robinhoodchain.blockscout.com";

type Hex = `0x${string}`;

export interface MainnetContract {
  readonly name: string;
  readonly chainId: typeof MAINNET_CHAIN_ID;
  readonly address: Hex;
  readonly deploymentTx: Hex;
  readonly block: number;
  readonly deployer: Hex;
  readonly runtimeBytes: number;
  readonly runtimeKeccak: Hex;
  /** What was verified about the deployed bytecode, and what was not. */
  readonly bytecodeStatus: string;
  readonly sourceStatus: string;
  /** Constructor state read back from the live contract. */
  readonly configuration: readonly (readonly [label: string, value: string])[];
  readonly operationalStatus: string;
  readonly evidencePath: string;
}

export const MAINNET_CONTRACTS: readonly MainnetContract[] = [
  {
    name: "OptraGuardHook",
    chainId: MAINNET_CHAIN_ID,
    address: "0x4089d38251fF25936d778C799d5d3AB5658c2080",
    deploymentTx: "0xdc17732c4568fb66735a7f240a586fbc8a4d513922b1c70d152e2b467a869fc0",
    block: 120_305_454,
    deployer: "0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf",
    runtimeBytes: 7085,
    runtimeKeccak: "0x152fcfec4be8caaca32ea621c32b9aafc7bad7d803293e4e0a9321fe58fdc6d7",
    bytecodeStatus: "Deployed runtime code is 7,085 bytes and equals a local rebuild of the approved source except for the constructor-set immutables.",
    sourceStatus: "Source published on Blockscout and Sourcify as a partial match, not an exact match: the contract was built with bytecode_hash = none, so the deployed code carries no metadata hash for a verifier to match. Not an audit.",
    configuration: [
      ["Admin and pool creator (Safe, 2 of 3)", "0xf9C76ef996C5cbC73E4E23927D6EecB3295c8d45"],
      ["Keeper (candidate EOA, no custody record)", "0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848"],
      ["Uniswap v4 PoolManager (external)", "0x8366a39CC670B4001A1121B8F6A443A643e40951"],
      ["Underlying", "native ETH (address zero)"],
      ["Quote token (USDG, external)", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"],
      ["Max policy age", "300 s"],
    ],
    operationalStatus: "Deployed, unaudited, uninitialized. No pool is bound, no keeper policy is published, it holds no funds, and it is not used by options execution. The Safe owners have not consented to initialize it.",
    evidencePath: "docs/evidence/p4/mainnet-deployment-record-20261122.md",
  },
];

export interface ExternalMainnetContract {
  readonly name: string;
  readonly role: string;
  readonly address: Hex;
  /** EIP-1967 implementation read from the proxy; null when the contract is not a proxy. */
  readonly implementation: Hex | null;
}

/** CallPut's own venue contracts. Third-party, not OPTRA-owned, not audited by OPTRA. */
export const MAINNET_EXTERNAL_CONTRACTS: readonly ExternalMainnetContract[] = [
  { name: "OptionsMarket", role: "Option listings and market state", address: "0x3271d35afAc70C0D4989F984Abb2d918bf672C7e", implementation: "0xBa75b452131613ABfAc9689342D2a3688c95fC7D" },
  { name: "PositionManager", role: "Open and close requests, execution fee, keeper queue", address: "0x426a6b482893557E58cF38de635fEbB30Fd6a3C3", implementation: "0x642126B59D79C097bE67745d97399b90Aa2e0d46" },
  { name: "SettleManager", role: "Expiry settlement", address: "0xd328D581f3Fb1Ca86D28D573bA1f17409e5112EF", implementation: "0x81de0057Bc0E0dA66011e42DD58aaD3b0858c444" },
  { name: "OptionsAuthority", role: "Venue access control", address: "0x85e00a193d5E340339484336dd9EA09f942A0b7B", implementation: "0x4175CA920Bf9935376Ab45Cd96E60C9348E8f093" },
  { name: "Controller", role: "USDG approval spender and order router", address: "0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B", implementation: "0xd13176DBf89b1AdC43fcede4642336103a16E003" },
  { name: "TradingAccountFactory", role: "Venue trading accounts and sessions (not used by OPTRA)", address: "0xbcaC622Bb396B2f868b37D7C41F34695c9be1862", implementation: null },
];

export const explorerAddressUrl = (address: string) => `${MAINNET_EXPLORER}/address/${address}`;
export const explorerTxUrl = (hash: string) => `${MAINNET_EXPLORER}/tx/${hash}`;
