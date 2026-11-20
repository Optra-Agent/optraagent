# CallPut Robinhood Live options integration (direct-wallet route)

Checked 2026-11-20 against Robinhood Mainnet (chain 4663). No transaction was signed or broadcast; every on-chain action below was a read or `eth_call`.

## Verified

| Item | Evidence |
|---|---|
| Write ABI | CallPut's official agent source (`ayggdrasil/callput-option-agent`, `src/core.ts`) and the live Robinhood MCP (`callput_execute_spread`, v0.8.2, `execution: unsigned_only`). Selector `0x4fd5f4af` = `createOpenPosition`. |
| Caller model | Direct wallet: the signer is `msg.sender`, the request `account` and the option-token holder. The MCP says "never substitute the login owner or account address on this direct-wallet route". No OPTRA contract is in the path. |
| Approvals | USDG `approve(spender = Controller 0x0D24…0e1B)`, sized to the exact amount. Option tokens: `setApprovalForAll(controller, true)` before close/settle. `PositionManager.controller()` and `SettleManager.controller()` both return the Controller. |
| Units | Collateral USDG, 6 decimals. Size is underlying units with 18 decimals (BTC 8). Feed `strikePrice` and `markPrice` are plain USD per unit. `underlyingAssetIndex` for AAPL = 16 (also encoded in the optionId). `executionFee()` = 60000000000000 wei, a flat native amount. |
| Open amount | Buy spread: premium × (1 + risk premium) × size + fee. Sell spread: strike width × size + fee. Fee = min(0.03% of notional, 12.5% of premium). Reproduced byte for byte against the venue's own unsigned payload (`tests/options/fixtures/callput-robinhood-venue-prepared-open.json`). |
| Lifecycle | `GenerateRequestKey(account, key, isOpen)` gives the canonical key. `openPositionRequests` / `closePositionRequests` give Pending 0, Cancelled 1, Executed 2. `maxTimeDelay` 180s. 30-minute pre-expiry buffer. No user cancel. |
| Simulation | `scripts/callput-robinhood-simulate-open.ts` runs `createOpenPosition` through `eth_call` with state overrides. It reverts without allowance and returns a request key with it, for BuyPutSpread, SellCallSpread and BuyCallSpread. This proves ABI, caller and approval spender against the deployed contracts at that block. It does not prove a fill. |

## Implemented

- `lib/venue/callput-robinhood-write.ts`: spread open, close and settle preparation, risk checks, pre-flight reads, request-key extraction, reconciliation.
- `app/api/venue/callput/market/route.ts`: one shared server-side read of the documented public feed (the S3 bucket sends no CORS headers), cached 15s.
- `components/app/tape/CallPutOrderPanel.tsx`, shown on Tape above the existing tracker: load market, pick legs, prepare, review, sign, track.
- Signing from the panel is off unless the build sets `NEXT_PUBLIC_CALLPUT_LIVE_ORDERS=true`. By default the panel is a preview and the Sign button stays disabled.
- Each transaction needs its own review checkbox. An open quote older than 60 seconds must be prepared again.

## Risk checks that block a prepare

Wrong chain, feed not tagged 4663 or older than 5 minutes, leg missing or unavailable, legs not matching the underlying/expiry/strike encoded in their optionIds, wrong strike order, inside the 30-minute expiry buffer, spread mark below the venue minimum, size with more than 18 decimals, collateral above the cap (default 100 USDG, the venue tooling default), execution fee zero or above 0.0003 ETH, insufficient USDG or ETH. Close and settle need positive `minAmountOut` and `minOutWhenSwap` floors, which the venue rejects at zero.

## Reconciliation rules

A receipt or tx hash is never an order. A request moves through `awaiting-request-key`, `request-not-found`, `pending`, `pending-past-delay`, `cancelled`, `executed-balance-unconfirmed` and `executed-balance-confirmed`. `fillConfirmed` is true only when the request is `Executed`, the reported `sizeOut` is greater than zero, and the wallet's option-token balance covers it. Open requests are stored in browser `localStorage` only.

## Disabled, with the reason

| Action | Why |
|---|---|
| Naked single-leg open (a protective put on its own) | `createOpenPosition` accepts `_length = 1`, but the venue's tooling and supported strategies list only the four spreads. Support is not documented, so it is not exported. A protective put is not available as a direct-wallet order today. |
| CallPut Account route (sponsored relay, session grant, delegated agent orders) | Different custody and delegation model, relayer-signed sessions, no OPTRA verification. Not implemented. |
| Automated or agent-initiated orders | CallPut Terms of Use prohibit scraping, and written permission for programmatic or automated trading has not been obtained. |
| Live Trading toggle | `LIVE_TRADING_ENABLED` is unchanged. |

## External dependencies still open

1. CallPut written permission for automated or agent-operated orders (section 5 of the integration request).
2. Source verification of the deployed contracts. The explorer API returned 403 earlier and the bytecode is unaudited here.
3. Whether the venue refunds unused `amountIn` after the keeper fills below the estimate. The first real order must be observed to settle this.
4. Settlement payout (`SettlePosition` event) and the close path for an in-the-money spread have not been exercised on-chain. Both are prepared and unit tested only.
5. MetaMask or Phantom extension acceptance of the transactions. Tests use a mocked wallet client.
