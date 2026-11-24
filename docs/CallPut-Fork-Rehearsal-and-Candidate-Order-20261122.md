# CallPut: fork rehearsal, candidate order, signing gate and Live Agent verdict (2026-11-22)

Nothing in this document was signed or broadcast on Robinhood Mainnet. Every execution below ran on a local anvil fork (chain id 4663) with a public test key.

## 1. Fork rehearsal of the open flow (PASS, Integration Verified)

Command: `anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port <p>` then `FORK_RPC=http://127.0.0.1:<p> bun run scripts/callput-fork-rehearsal.ts AAPL BuyPutSpread 0.1` (refuses any non-local RPC).

The script builds the plan with the same `prepareCallPutOpenSpread` the Tape panel uses, funds a fork-only signer with USDG by writing the token's balance slot, executes the two prepared transactions for real against the forked venue contracts, then runs the app's `extractCallPutRequestKey`, `readCallPutRobinhoodRequest` and `reconcileCallPutOpen`.

Result of the run: both transactions `success` (USDG approve 57,976 gas; `createOpenPosition` 584,027 gas). The request key came from the receipt's `GenerateRequestKey` event. `openPositionRequests` read back status Pending, account equal to the signer, amountIn 240,517 raw (equal to the quote), minSize 78% of size. The signer's USDG fell by exactly amountIn and PositionManager's USDG balance rose by the same amount. Reconciliation said `pending`, and `pending-past-delay` once 181 s had passed. Neither state was reported as a fill. Six assertions passed.

Not covered by this open-flow rehearsal, because it needs the venue keeper: the Executed state, the option-token balance after a fill, close, and settlement. Those are covered by the lifecycle rehearsal in section 6.

## 2. Venue facts re-verified on chain

- The five proxies (OptionsMarket, PositionManager, SettleManager, OptionsAuthority, Controller) each have 2,227 bytes of proxy code, and their EIP-1967 implementation slots equal the addresses pinned in `lib/chain/mainnet-contracts.ts`. TradingAccountFactory has 10,277 bytes of code.
- Real venue activity exists but is sparse: only 3 PositionManager logs in the last 400,000 blocks. The latest example is a CLOSE request (the `GenerateRequestKey` event has `isOpen` = 0), created in tx `0xa509d69f…c97d` at block 120,077,176 by a CallPut TradingAccount calling `closeWithSession`. The keeper `0x0c05A845…00BaA` executed it 37 blocks later by calling `FastPriceFeed.setPricesAndRiskPremiumsWithBitsAndExecute` (tx `0xcd4e361b…5dfe`), and the receipt shows USDG paid out to the account. This is evidence that the venue's session route, keeper execution and close payout work for someone else's position. It is not an OPTRA order, and only the close-with-session call was observed (no open-with-session call was seen).
- Instrument data comes from the venue feed already wired into the app: underlying asset indices (AAPL = 16), option ID encoding (asset index, expiry, strike), USDG 6 decimals, size 18 decimals, execution fee 0.00006 ETH, 180 s max delay, fee = min(0.03% of notional, 12.5% of premium). See `docs/CallPut-Robinhood-Live-Options-Integration.md`.

## 3. Candidate order (EXTERNAL AUTHORIZATION REQUIRED to send)

Snapshot taken 2026-11-22T03:33:07Z by `bun run scripts/callput-candidate-order.ts AAPL BuyPutSpread 0.1 3`, saved with calldata in `docs/evidence/callput/candidate-order-20261122.json`. The quote is an estimate and must be re-prepared in the panel if older than 60 seconds when signing.

| Item | Value |
|---|---|
| Strategy | Buy Put Spread, AAPL, Robinhood Mainnet chain 4663 |
| Long leg | AAPL-27NOV26-350-P, mark 5.7011 USD |
| Short leg | AAPL-27NOV26-345-P, mark 3.7400 USD |
| Expiry | 2026-11-27 17:00 UTC |
| Spot | 348.692 USD |
| Size | 0.1 AAPL (raw 100000000000000000); minimum fill 78% |
| Estimated execution price | 2.3571 USDG per unit; premium about 0.2357 USDG |
| Estimated venue fee | 0.01046 USDG |
| Maximum USDG exposure | 0.246168 USDG (246168 raw) |
| Native execution fee | 0.00006 ETH, not assumed refundable |
| Transaction 1 | USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, `approve(0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B, 246168)`, value 0 |
| Transaction 2 | PositionManager `0x426a6b482893557E58cF38de635fEbB30Fd6a3C3`, `createOpenPosition(...)`, value 60000000000000 wei |
| Worst case | the 0.246168 USDG collateral plus the 0.00006 ETH execution fee plus gas |

To send it, open Tape in production, connect the wallet that will own the position, pick AAPL, Buy Put Spread, expiry 27NOV26, long 350P and short 345P, size 0.1, max collateral 1, then Prepare order. Compare each `to`, value and amount with the table, tick the review box for each transaction and confirm it in the wallet. Do not resubmit if the request stays Pending: the venue has no user cancel.

## 4. Signing gate

- Open-order signing (`NEXT_PUBLIC_CALLPUT_LIVE_ORDERS`) is enabled in the Docker image build. The panel states that it is real money and unaudited, blocks on risk checks, and needs a review checkbox plus a wallet confirmation for every transaction.
- Close signing (`NEXT_PUBLIC_CALLPUT_CLOSE`) and settle signing (`NEXT_PUBLIC_CALLPUT_SETTLE`) are separate flags, both set in the Docker image after the section 6 lifecycle rehearsal passed. Each transaction still needs a review checkbox and a wallet confirmation. Neither has run against a live keeper fill, so a real close and a real settlement remain unproven until an owner-held position exists.
- `LIVE_TRADING_ENABLED` is unchanged and still governs only server-side agent execution.
- Not yet tested: a real MetaMask or Phantom extension (tests use a scripted EIP-1193 wallet) and a live fill.

## 5. Live Agent: delegation capability and verdict (BLOCKED, venue permission unresolved)

What the venue supports: TradingAccount contracts with session-key execution (a `closeWithSession` call with an owner-signed session struct was observed on chain), and a CallPut Account workflow with `open_close` and `close_only` session modes and a distinct device signer (see `docs/CallPut-Live-Agent-Architecture.md`).

Why OPTRA cannot enable it:

1. Using it needs a server-held session or device signer key. The brief forbids unrestricted server-held keys, and no OPTRA-specific on-chain scope, spend cap or revocation has been verified for a delegated session.
2. Venue permission for an operator-held session key is unresolved. CallPut Docs v3 Terms and AI-agent pages reviewed 2026-11-24 do not answer whether OPTRA automation or an operator-held Account signer is permitted. The agent docs describe unsigned payload preparation followed by external wallet approval/signing, which is not OPTRA-specific authorization. Obtain written CallPut confirmation of automation permission, the supported signer model, applicable jurisdiction/terms, polling limits and support; do not infer permission or prohibition from silence.
3. The account/session contracts have had no independent audit and no order-to-settlement trial for an account route.

Preserved and working: the monitoring worker, durable grant, request and stop ledger, owner API, Tape controls, and Paper automation. `LIVE_TRADING_ENABLED` stays false, so every live-agent reservation fails closed. Real-money automation remains off.

## 6. Fork lifecycle rehearsal: open, keeper fill, close, settle (23/23 PASS)

Command, on a fresh fork each time: `anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8561` then `FORK_RPC=http://127.0.0.1:8561 bun run scripts/callput-fork-lifecycle.ts AAPL BuyPutSpread 0.1`. Full output: `docs/evidence/callput/fork-lifecycle-20261122.log`. The script refuses a non-local RPC and a fork whose clock an earlier run already advanced.

How the keeper is played: the harness impersonates the real keeper account and sends the same `FastPriceFeed.setPricesAndRiskPremiumsWithBitsAndExecute` call the real keeper uses (calldata layout decoded from a real keeper transaction by `scripts/callput-decode-keeper-tx.ts`), with prices taken from the live feed. All fills, payouts and reverts below come from the real CallPut contracts on the fork. Price inputs and timing are the harness's, so this is not a statement about what the live keeper will do for an OPTRA order.

What passed: an open request pulls the committed collateral; a Pending request is not reported as a fill; a keeper pass without fresh option prices cancels the request and returns the collateral; a keeper fill reports Executed with the position confirmed only by the option-token balance and no refund of unused collateral; close is refused above the wallet balance, without a minAmountOut floor, and inside the 30-minute pre-expiry buffer; the close plan asks for the Controller approval and then the close request; while Pending the tokens have left the wallet yet the app reports no close; the keeper executes a partial close and the USDG payout equals the reported amountOut; the remainder stays held; close after expiry is routed to settlement; settlement before expiry is refused by the app and reverted by the venue (`SettleManager: Option not expired`); settlement after expiry matches the event and the balance reduction; settling twice reverts (`No position to settle`).

Three findings from building it, each now handled in code or documented:

1. ERC-1155 receiver. The keeper delivers option tokens with `safeTransferFrom`. An account with contract code (a smart account or an EIP-7702 delegation) whose fallback does not return the ERC-1155 receiver value makes every fill revert, and the venue then cancels the request and keeps the execution fee. On the fork, the well-known test-mnemonic address #32 is such an account on Robinhood Mainnet. `readCallPutWalletState` now probes this the way the venue calls it, and `prepareCallPutOpenSpread` blocks with check `account-erc1155`. The owner's deployer account `0xAa8f…0bBf` has no code and passes.
2. Spot feed freshness. The venue refuses fills and settlements when its spot feed is older than `updateDuration` (300 s). The live feed is fresh (age 191 s when read on a Sunday), so this affects only fork time travel: the harness republishes the venue's own spot prices before each keeper pass and before settlement.
3. Settlement fee. For a buy position the venue collects a position fee at settlement, so the payout is net of it: received 246,087 raw against a gross spread payoff of 249,480 raw, a fee of 3,393 raw (1.36%) on this run. The settlement event reports only the net amount. The settle review in the app now says so. The rate comes from one run; it is not a verified constant.

Live Agent venue capability, read-only: `lib/venue/callput-account-capability.ts` reads the venue's own `callput://account/workflow` MCP resource (fixture `tests/options/fixtures/callput-account-workflow-resource-20261122.json`) and the Live Agent status route reports whether the venue enforces a distinct session signer, scoped instrument, open_close/close_only modes and owner revoke/recover. That is evidence about the venue only. The verdict in section 5 is unchanged.

Fresh preflight of the candidate order against live chain data for the owner's deployer account, 2026-11-22T05:45Z: `docs/evidence/callput/candidate-order-preflight-20261122.json`. The Controller's own `validateOpenPosition` accepted both legs and the exact spread; both legs are available in the feed; the account accepts ERC-1155; USDG 0.450270 covers the 0.258411 USDG maximum exposure; allowance is 0, so the approval is needed; ETH 0.000387 covers the 0.00006 ETH execution fee plus gas. Re-prepare in the panel before signing because the quote ages out after 60 s.
