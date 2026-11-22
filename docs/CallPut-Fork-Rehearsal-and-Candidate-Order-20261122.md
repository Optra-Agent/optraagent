# CallPut: fork rehearsal, candidate order, signing gate and Live Agent verdict (2026-11-22)

Nothing in this document was signed or broadcast on Robinhood Mainnet. Every execution below ran on a local anvil fork (chain id 4663) with a public test key.

## 1. Fork rehearsal of the open flow (PASS, Integration Verified)

Command: `anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port <p>` then `FORK_RPC=http://127.0.0.1:<p> bun run scripts/callput-fork-rehearsal.ts AAPL BuyPutSpread 0.1` (refuses any non-local RPC).

The script builds the plan with the same `prepareCallPutOpenSpread` the Tape panel uses, funds a fork-only signer with USDG by writing the token's balance slot, executes the two prepared transactions for real against the forked venue contracts, then runs the app's `extractCallPutRequestKey`, `readCallPutRobinhoodRequest` and `reconcileCallPutOpen`.

Result of the run: both transactions `success` (USDG approve 57,976 gas; `createOpenPosition` 584,027 gas). The request key came from the receipt's `GenerateRequestKey` event. `openPositionRequests` read back status Pending, account equal to the signer, amountIn 240,517 raw (equal to the quote), minSize 78% of size. The signer's USDG fell by exactly amountIn and PositionManager's USDG balance rose by the same amount. Reconciliation said `pending`, and `pending-past-delay` once 181 s had passed. Neither state was reported as a fill. Six assertions passed.

Not covered, because it needs the venue keeper: the Executed state, the option-token balance after a fill, close, and settlement. A fork does not run the keeper. Close and settle signing therefore stay disabled in the production build (flag `NEXT_PUBLIC_CALLPUT_POSITION_ACTIONS`, off).

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
- Close and settle signing (`NEXT_PUBLIC_CALLPUT_POSITION_ACTIONS`) is off in every build until an opened position has been verified end to end.
- `LIVE_TRADING_ENABLED` is unchanged and still governs only server-side agent execution.
- Not yet tested: a real MetaMask or Phantom extension (tests use a scripted EIP-1193 wallet) and a live fill.

## 5. Live Agent: delegation capability and verdict (BLOCKED, verified external limitation)

What the venue supports: TradingAccount contracts with session-key execution (a `closeWithSession` call with an owner-signed session struct was observed on chain), and a CallPut Account workflow with `open_close` and `close_only` session modes and a distinct device signer (see `docs/CallPut-Live-Agent-Architecture.md`).

Why OPTRA cannot enable it:

1. Using it needs a server-held session or device signer key. The brief forbids unrestricted server-held keys, and no OPTRA-specific on-chain scope, spend cap or revocation has been verified for a delegated session.
2. CallPut's Terms of Use prohibit scraping and automated access; written permission for programmatic or agent-operated orders has not been obtained.
3. The account/session contracts have had no independent audit and no order-to-settlement trial for an account route.

Preserved and working: the monitoring worker, durable grant, request and stop ledger, owner API, Tape controls, and Paper automation. `LIVE_TRADING_ENABLED` stays false, so every live-agent reservation fails closed. Real-money automation remains off.
