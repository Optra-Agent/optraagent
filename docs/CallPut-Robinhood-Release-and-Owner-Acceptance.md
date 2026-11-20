# CallPut Robinhood Live options: release review and owner acceptance packet

Date: 2026-11-20. Nothing was signed, broadcast or transferred. Live order signing is disabled in the release build.

## 1. Release status

| Check | Result |
|---|---|
| `bun run test` | 50 files passed, 2 skipped. 252 tests passed, 2 skipped. |
| `bun run lint`, `bun run typecheck` | Clean. |
| `bun run build` (default env) | Passes. `/tape` and `/api/venue/callput/market` are in the route table. |
| Default build, in a browser | CallPut panel shows "Preview only" and "Signing is disabled in this build". |
| Build with `NEXT_PUBLIC_CALLPUT_LIVE_ORDERS=true` (local only, then rebuilt without it) | Panel shows "Signing enabled". |
| Flag location | Set nowhere in the repo, `Dockerfile`, `deploy/` or `.railway/`. A production image is flag-off unless someone adds it at build time. |
| Paper Trading | Existing Paper and Tape tests pass. The panel is added above the existing tracker with no other layout change. |

### Verified in a real browser (production build, mock EIP-1193 wallet)

- The app connects through its real wagmi connectors to an injected MetaMask provider and to `window.phantom.ethereum`. Both run the normal connect calls and send no transaction.
- Market load, expiry and leg selection, and Prepare use real Robinhood Mainnet reads. For a funded address the review showed a 3.169 USDG approval (spender: Controller) and the open request with a 0.00006 ETH execution fee.
- With the flag on, the Sign button stays disabled until the per-transaction review box is ticked. One click produced exactly one `eth_sendTransaction`: `approve(Controller, amount)` on USDG, from the connected account. The mock rejected it with code 4001. The panel showed "You rejected the request in your wallet. Nothing was sent." and stored nothing.

### Covered by automated tests

Rejected signature, reverted transaction, quote older than 60 seconds, insufficient USDG, insufficient ETH, RPC failure (endpoint URL redacted), feed down (no quote shown), collateral above the user's cap, pending, cancelled, executed without balance evidence, executed with balance evidence, missing record, and an RPC error during status refresh (stored request unchanged).

### Not verified

- A real MetaMask or Phantom extension. The mock wallet proves OPTRA's connector and transaction wiring only. It does not prove extension UI, network-add prompts or fee display.
- The SIWE sign-in. Local auth returned 503 (no database), so wallet connection was tested without a session. The panel works from the wagmi connection and does not use the session.
- Any Mainnet write, close or settle execution. Those paths are simulated or unit tested only.

## 2. Release scope

Files for this track (nothing else is part of it):

- `lib/venue/callput-robinhood-write.ts`
- `app/api/venue/callput/market/route.ts`
- `components/app/tape/CallPutOrderPanel.tsx`
- `components/app/tape/TapeScreen.tsx` (two lines: import and mount)
- `scripts/callput-robinhood-simulate-open.ts`
- `tests/options/callput-robinhood-write.test.ts`, `tests/options/callput-market-route.test.ts`, `tests/options/fixtures/`
- `tests/app/callput-order-panel.test.ts`, `tests/app/callput-request-tracker.test.ts` (wagmi mock gained two hooks)
- `docs/CallPut-Robinhood-Live-Options-Integration.md`, this file

Not part of this track, belongs to the P4 Mainnet agent or is generated: everything under `contracts/`, `docs/MAINNET_*`, `docs/contract-deployment-plan.md`, `docs/CallPut-Robinhood-Mainnet-Integration-Request.md`, `lib/venue/callput-robinhood-readonly.ts` and its feed test (uncommitted edits that are not mine), `next-env.d.ts`, `tsconfig.json`, `tsconfig.tsbuildinfo`.

Commit only the files listed above, by explicit path. Do not `git add -A`.

### Review findings

1. Fixed: select ids contained spaces, which broke label association. Fixed with an Expiry selector and proper ids.
2. Fixed: wallet rejections showed a long viem dump. They now show one plain line.
3. Fixed: the 100 USDG default collateral cap was not user-visible. There is now a "Max collateral (USDG)" field, default 5.
4. Known: open requests are kept in browser `localStorage` only, not on a server.
5. Known: `setApprovalForAll` for close or settle covers every option token of that underlying for that Controller. The UI says so. Revoke with `setApprovalForAll(controller, false)`.

## 3. Manual wallet-signed trading versus automated agent execution

| | Manual wallet-signed (built) | Automated agent execution (not supported) |
|---|---|---|
| Who signs | The owner, in their own wallet, once per transaction | Nobody. No key, session key or relayer exists. |
| Trigger | The owner clicks, ticks the review box and approves in the wallet | None. No OPTRA agent, cron or Paper decision can reach this code. |
| Venue route | CallPut direct wallet | CallPut Account relay and sessions: not implemented |
| Permission | The owner's own action on a public protocol | Blocked on CallPut's written permission for programmatic or agent-operated orders |
| Paper agents | Unchanged and separate. Venue data never creates or implies a Paper fill. | Unchanged |

## 4. Owner acceptance procedure: one minimal manually approved spread

Nothing below runs until you approve the exact action in a separate message. I will not enable the flag, build a signing release, or open a wallet prompt before that.

### Parameters

| Item | Value |
|---|---|
| Network | Robinhood Chain Mainnet, chain ID 4663 |
| Signer | One EOA you control that holds the USDG and ETH. Give me the address and I will pin it. It must be the wallet that will own the position. |
| Strategy | BuyPutSpread, AAPL, nearest listed expiry at least 3 days out, two adjacent strikes near spot |
| Size | 0.1 AAPL (underlying units, 18 decimals) |
| Collateral cap | 1 USDG (set in the panel; blocks the order above this) |
| Expected collateral | About 0.3 to 0.4 USDG. For reference, size 1 gave 3.1 to 3.2 USDG on 2026-11-20. The exact figure comes from the review screen. |
| Minimum fill | 78% of size (7800 bps), raw `minSize` shown on the review screen |
| Execution fee | 60,000,000,000,000 wei (0.00006 ETH), paid in `msg.value` on the open request. Not assumed refundable. |
| Gas | A small ETH reserve on top of the execution fee for two transactions |
| Funds needed | About 0.5 USDG and at least 0.001 ETH. Anything more is not at risk from this order. |

### Transactions, in order

| # | Contract | Call | Value |
|---|---|---|---|
| 1 | USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | `approve(spender = 0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B, amount = estimated collateral in raw 6-decimal units)` | 0 |
| 2 | PositionManager `0x426a6b482893557E58cF38de635fEbB30Fd6a3C3` | `createOpenPosition(16, 2, [true,false,false,false], [longOptionId, shortOptionId, 0, 0], [false,false,false,false], minSize, [USDG], amountIn, 0, 0x0)` | 60000000000000 wei |

The approval is the exact amount, not unlimited. The spender is the CallPut Controller, which `PositionManager.controller()` returns and the panel re-reads before preparing. Both the approval and the open request come from the review screen, and you compare each `to`, `value` and the raw amount with this table before approving in the wallet.

### Risk limits enforced before a wallet prompt

Chain 4663 only. Feed tagged for 4663 and not older than 5 minutes. Both legs present, available, same underlying and expiry, strikes matching their IDs, correct strike order. At least 30 minutes to expiry. Size with no more than 18 decimals. Collateral at or below your cap. Execution fee non-zero and at most 0.0003 ETH. USDG and ETH balances sufficient. Open quote no older than 60 seconds at signing, otherwise it must be prepared again. One transaction per click, with a review box for each.

### Pre-approval steps (no signing, I run these)

1. Re-run `bun run scripts/callput-robinhood-simulate-open.ts AAPL BuyPutSpread 0.1`. Expect the control to revert without allowance and the simulation to return a request key with it.
2. Read the signer's USDG balance, ETH balance, allowance and `executionFee()` on chain 4663.
3. Build with `NEXT_PUBLIC_CALLPUT_LIVE_ORDERS=true` for a local run only. The production artifact stays flag-off.
4. You give the signer address and the final numbers. You then approve in a message: "Approve: <signer>, USDG approval of <raw amount> to 0x0D24…0e1B, open request with 60000000000000 wei, cap <x> USDG."

### Execution (you do these in your wallet)

1. Open Tape, connect the signer, choose AAPL, BuyPutSpread, the expiry and legs, size 0.1, max collateral 1, then Prepare order.
2. Check the review against the table above. Tick the box for transaction 1 and sign the approval.
3. Wait for "Confirmed". Tick the box for transaction 2 and sign the open request within 60 seconds of Prepare.
4. The panel stores the request key from the `GenerateRequestKey` event. Copy it.

### Reconciliation

Use Refresh status, or the CallPut request tracker on the same page, with the request key.

| State shown | Meaning | Action |
|---|---|---|
| `pending` | In the keeper queue. No fill. | Keep polling. |
| `pending-past-delay` | Still Pending after the 180s `maxTimeDelay`. No user cancel exists. | Keep polling. Do not resubmit. |
| `cancelled` | Keeper outcome, no fill. The execution fee is not refunded. | Re-read the market before any retry. |
| `executed-balance-unconfirmed` | The getter says Executed, but your option-token balance does not yet cover `sizeOut`. | Not a fill. Check again, then check the AAPL option token balance on the explorer. |
| `executed-balance-confirmed` | Executed and your balance covers `sizeOut`. | Treated as filled. |

After a fill, record: request key, tx hashes, `optionTokenId`, `sizeOut`, `amountOut`, `executionPrice`, and the USDG balance before and after. The last item answers the open question about whether unused `amountIn` is returned. Close and settlement are not part of this first order. Do not close it until you approve a separate close packet.

### Abort conditions

Stop and do not sign if any `to`, `value`, spender, chain ID or amount differs from the table. Also stop if the cap, balance or freshness checks fail, if the wallet shows a different network, or if the signer is not the pinned address.

## 5. Open dependencies

1. CallPut written permission for automated or agent-operated orders (blocks section 3, right column).
2. Source verification of the deployed contracts (explorer API returned 403 earlier).
3. Whether unused `amountIn` is refunded. The first real order answers this.
4. Real-extension check of MetaMask and Phantom. It happens when the owner signs the first transaction.
5. Close and settlement on Mainnet, to be covered by separate packets.
