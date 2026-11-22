# CallPut wallet flow: owner acceptance in your own Chrome

Scope: the CallPut Mainnet contracts are external (PositionManager, Controller, USDG, option tokens on Robinhood Chain, chain ID 4663). OPTRA never deploys or controls them. Nothing in Part A or B moves funds. Part C is a real order and only runs after you approve that exact action in a separate message.

## What the Tape page does now

| Step | Where | Evidence |
|---|---|---|
| MetaMask / Phantom (EVM) connection | wallet button in the top bar; `lib/chain/wallets.ts` | `tests/e2e/callput-wallet-network.spec.ts` (scripted MetaMask provider) |
| Network validation and switch | "CallPut options order" panel, status row | `tests/app/callput-order-panel.test.ts` (wrong chain blocks signing; switch request; rejected switch). wagmi adds the chain when the wallet answers 4902. |
| Live market, strike, expiry, collateral, eligibility | same panel; `lib/venue/callput-robinhood-write.ts` risk checks | `tests/options/callput-robinhood-write.test.ts` |
| Fresh unsigned order, simulation, fee estimate, allowance, risk | same panel, "Order review" | `tests/app/callput-order-panel.test.ts` |
| Owner review and signing | per-transaction review box, then wallet (flag-gated) | production stays "Preview only" |
| Duplicate-request protection | one signature in flight; an identical unresolved submission blocks a second open for 30 minutes unless the earlier one ended | `tests/options/callput-order-lifecycle.test.ts`, panel test |
| Order history and asynchronous reconciliation | "CallPut order history" panel; re-reads the chain every 20 s while an order is unresolved | `tests/app/callput-order-history.test.ts`, `tests/options/callput-order-lifecycle.test.ts` |

Outcome rules the history panel applies (`lib/venue/callput-order-lifecycle.ts`):

- The server ledger stores only references the browser reported (`client-reported-reference`). Every status is read from the chain.
- A transaction hash proves inclusion. It never proves an options fill. An open is a position only when PositionManager reports the request Executed and your option-token balance covers `sizeOut`.
- An approval is an allowance, not an order.
- An intent with no transaction reference is shown as ambiguous: check your wallet activity before preparing again.
- A mined open whose request key was never stored is recovered from the receipt log. A receipt with no request log is not an order.
- An RPC failure keeps the stored references and retries; nothing is inferred from it.

Handled failure cases: rejected signature (one plain line, nothing stored), insufficient USDG or ETH (blocked before the prompt), quote older than 60 s or gas older than 30 s (prepare again), RPC failure (endpoint redacted), ambiguous submission (above), reverted transaction (terminal, a new order must be prepared and reviewed), unsupported operations (single-leg opens, the CallPut Account relay and agent-operated orders are not offered).

## Verified limitation: no delegated agent execution

The venue's account/session workflow exists, but CallPut has not confirmed or authorized any delegation model for an OPTRA agent, and OPTRA holds no key, session signer or relayer. There is no submission route in the code. Live Agent financial execution therefore stays disabled (`LIVE_TRADING_ENABLED=false`, fail-closed grants). Only the owner's own wallet signs, once per transaction. Details: `docs/CallPut-Live-Agent-Architecture.md`.

## Part A: production, no signing (about 5 minutes)

Use Chrome with MetaMask or Phantom (EVM). Open `https://opetra-production.up.railway.app/tape`.

1. Before connecting, the CallPut panel says "No wallet connected". The chip says "Preview only".
2. Click Connect wallet, choose your wallet. Approve the connection. If the wallet is not on Robinhood Chain, the panel shows "Wrong network · chain N" and "Signing is blocked". Click "Switch to Robinhood Mainnet" and approve the wallet's network prompt. Expect "Robinhood Mainnet · 4663" and your connector name and address.
3. Optional: sign in. The wallet shows a plain message signature, not a transaction. Rejecting it must leave you signed out and show "The wallet request was rejected. No session was created."
4. Load market for AAPL, pick an expiry and two legs, set size 0.1 and max collateral 1, click Prepare order. Expect an order review with collateral, fee, minimum fill, execution fee, gas limit and fee ceiling, and the raw `to`, value and calldata. "Signing is disabled in this build. Nothing was sent." stays visible and "Sign in wallet" stays disabled.
5. If you signed in, the "CallPut order history" panel appears. It lists any saved orders (none yet) and the explanatory note about hashes.
6. Record: browser and wallet versions, a screenshot of steps 2 and 4 (mask the address if you prefer), any prompt text that looked wrong.

Pass: no wallet transaction prompt appeared at any point, the network switch worked, the review values match expectations.

## Part B: local signing build, reject the first prompt

This proves the signing path and your extension's prompts without sending anything.

```
git checkout <release commit>
DATABASE_URL= PGLITE_DATA_DIR=.local/callput-acceptance-db NEXT_PUBLIC_CALLPUT_LIVE_ORDERS=true bun run dev -- -p 3105
```

`DATABASE_URL=` (empty) keeps any `.env` file from pointing this server at the production database; it uses a throwaway embedded database instead. Open `http://localhost:3105/tape` (sign-in and order history work against that local database). Repeat Part A steps 1 to 4. The chip now reads "Signing enabled". Tick the review box and click "Sign in wallet". Your wallet shows an `approve` on USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (or the open request on PositionManager `0x426a6b482893557E58cF38de635fEbB30Fd6a3C3`). Compare `to`, value and amount with the review, then **reject** it. Expect "You rejected the request in your wallet. Nothing was sent." and no new row in the history panel with a transaction.

Pass: exactly one wallet prompt, correct `to` and amount, rejection leaves no transaction. Stop the server when done. Never run this build against a wallet you do not control.

## Part C: one real order (separate approval required)

Not covered by anything above. The one-order packet, its exact limits and the approval message are in `docs/CallPut-Robinhood-Release-and-Owner-Acceptance.md` section 4. No order is submitted until you send that approval for a named signer. After it, use the history panel and the request tracker with the request key, and record the request key, both transaction hashes, option token ID, `sizeOut` and the USDG balance before and after. A fill counts only as "Balance-confirmed" in the history panel.
