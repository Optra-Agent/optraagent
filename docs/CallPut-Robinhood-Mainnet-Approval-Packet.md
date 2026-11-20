# CallPut Robinhood Mainnet: transaction approval packet (one BuyPutSpread)

Status: NOT APPROVED, NOT EXECUTED. No transaction in this packet has been signed or broadcast. Production runs with live signing disabled.

Reference numbers were read from Robinhood Mainnet at block 118931563 on 2026-11-20 with `scripts/callput-robinhood-approval-packet.ts`. The market moves, so the executed amounts come from a fresh Prepare. The bounds below are what you approve.

## 1. Exact action

| Item | Value |
|---|---|
| Network | Robinhood Chain Mainnet, chain ID 4663, RPC `https://rpc.mainnet.chain.robinhood.com` |
| Signer | **Owner to supply.** One EOA you control. It pays, signs and owns the position. Written into the approval message below. |
| Order | BuyPutSpread on AAPL, size 0.1 (raw `100000000000000000`, 18 decimals) |
| Legs at reference time | Long `AAPL-27NOV26-355-P`, short `AAPL-27NOV26-350-P`, expiry 1795798800 (27 Nov 2026 17:00 UTC) |
| Long optionId | `0x0010006b09b71000000000016300000000000000000000000000000000000000` |
| Short optionId | `0x0010006b09b71000000000015e00000000000000000000000000000000000000` |
| Minimum fill | 78% = raw `78000000000000000` |
| Underlying index | 16 (AAPL) |
| Standalone Protective Put | Not offered and not executable. A single-leg open is disabled. |
| Automated or agent trading | Not offered and not executable. |

The long put is the protective leg, so the order is a bought put spread (a defined-risk hedge), not a naked put.

## 2. Transactions, in order

### Transaction 1: USDG approval

| Field | Value |
|---|---|
| From | The signer |
| To (USDG token) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Function | `approve(address spender, uint256 amount)` |
| Spender (CallPut Controller) | `0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B` |
| Amount at reference | raw `291131` = 0.291131 USDG (6 decimals) |
| Approval bound | The amount must equal the Prepare estimate and be at most raw `1000000` (1 USDG). Never unlimited. |
| ETH value | 0 |
| Gas estimate / ceiling | 41,248 / 53,622 |
| Calldata at reference | `0x095ea7b30000000000000000000000000d240c1ebeee7f74b40d6611326f5df98ab00e1b000000000000000000000000000000000000000000000000000000000004713b` |

### Transaction 2: open request

| Field | Value |
|---|---|
| From | The signer |
| To (PositionManager) | `0x426a6b482893557E58cF38de635fEbB30Fd6a3C3` |
| Function | `createOpenPosition(uint16 16, uint8 2, bool[4] [true,false,false,false], bytes32[4] [long, short, 0x0, 0x0], bool[4] [false,false,false,false], uint256 minSize, address[] [USDG], uint256 amountIn, uint256 0, address 0x0000000000000000000000000000000000000000)` |
| Execution fee (`msg.value`) | **60,000,000,000,000 wei = 0.00006 ETH**, flat, not assumed refundable |
| `amountIn` at reference | raw `291131` (the same figure as the approval) |
| Gas estimate / ceiling | 603,354 / 784,360 |
| Selector | `0x4fd5f4af` |
| Full calldata at reference | See `bun run scripts/callput-robinhood-approval-packet.ts <signer> AAPL 0.1`. The wallet shows the final bytes. |

The ceilings are 1.3 times the `eth_estimateGas` result. The panel does not set gas. Your wallet estimates it. Reject if the wallet's gas limit is above the ceiling.

### Funds required

| Item | Amount |
|---|---|
| USDG | At least 0.30 USDG (reference 0.291131) |
| ETH | At least 0.0001 ETH. Execution fee 0.00006 ETH plus worst-case gas about 0.000017 ETH (gas price 20,372,000 wei at reference) gives about 0.000077 ETH. |
| Most that can leave the wallet | 1 USDG (the cap) plus 0.00006 ETH execution fee plus gas |

## 3. Risk limits, enforced before any wallet prompt

Chain 4663 only. Controller re-read from `PositionManager.controller()` and compared with the pinned address. Feed tagged 4663 and no older than 5 minutes. Both legs listed, available, same underlying and expiry, strikes match their IDs, long strike above short strike. At least 30 minutes to expiry. Max collateral field set to 1 USDG. Execution fee above zero and at most 0.0003 ETH. USDG and ETH balances sufficient. Open request must be signed within 60 seconds of Prepare. One review box per transaction. One signing action per click.

## 4. Controlled live-signing build (not deployed)

Production does not allow signing, and Railway cannot be switched by a variable: the `Dockerfile` has no build `ARG`, so `NEXT_PUBLIC_CALLPUT_LIVE_ORDERS` never reaches `next build`. The live-signing build is therefore a local artifact for acceptance.

| Item | Value |
|---|---|
| Source | Release commit `b1766920d6334c452613bd8ca437faea7e3b8a48` (main), exported to `~/optra-live-signing-b176692` |
| Build | `NEXT_PUBLIC_CALLPUT_LIVE_ORDERS=true OPTRA_E2E_DIST_DIR=.next-live bun run build` |
| Build ID | `QrX1Lc9XBtPcXMpA60S_V` |
| Artifact digest | SHA-256 over `static/` and `server/`: `a77be0219dde93403d56277fa888765816c61fcd621e6bf1dfba738588a0a5e3` |
| Run | `cd ~/optra-live-signing-b176692 && OPTRA_E2E_DIST_DIR=.next-live bunx next start -p 3200`, then open `http://localhost:3200/tape`. The panel chip reads "Signing enabled". |

It is not running, and nothing was deployed from it. Start it only after the approval message below.

## 5. Approval message (the owner sends this to enable the run)

> Approve one Mainnet order. Chain 4663. Signer `<full 0x address>`. Transaction 1: USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` approve spender `0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B`, amount at most raw 1000000 and equal to the Prepare estimate. Transaction 2: PositionManager `0x426a6b482893557E58cF38de635fEbB30Fd6a3C3` createOpenPosition BuyPutSpread AAPL size 0.1, value 60000000000000 wei, gas ceilings 53,622 and 784,360. Run the local live-signing build only.

Before sending it I will rerun the packet script with your signer address. That checks your real USDG and ETH balances and allowance, and produces the final amounts.

## 6. Owner actions

1. Send the signer address. I rerun the packet script and confirm balances.
2. Send the approval message above. I start the local live-signing build.
3. Open `http://localhost:3200/tape`. Connect the signer (MetaMask or Phantom EVM). Confirm the wallet network is Robinhood Chain 4663.
4. Pick AAPL, BuyPutSpread, the expiry and legs shown in section 1 (or the nearest adjacent pair if the market moved), size 0.1, max collateral 1. Press Prepare order.
5. Compare each `to`, value and raw amount with section 2. Tick the box for transaction 1, press Sign in wallet, and check the wallet's spender, amount and gas. Approve.
6. When transaction 1 shows Confirmed, tick the box for transaction 2 and sign it within 60 seconds. If the quote expires, prepare again.
7. Copy the request key shown under "Last submitted request". Keep both transaction hashes.
8. Press Refresh status until it reads `executed-balance-confirmed` or `cancelled`.
9. Stop the local server. Send me the request key and both hashes. I check them against the chain and record the evidence.

Stop and do not sign if the chain, signer, `to`, spender, amount, value or gas differs from this packet.

## 7. Recovery procedures

| Situation | What happened | What to do |
|---|---|---|
| Wallet rejection | Nothing was sent. | Prepare again and retry, or stop. |
| Approval confirmed, open never sent | An allowance of at most 1 USDG to the Controller is outstanding. | Revoke: `approve(0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B, 0)` on the USDG token. |
| Open transaction reverted | Gas is spent. No request exists. Allowance stays. | Revoke the allowance, or retry after a fresh Prepare. |
| Open mined, request `pending` | In the keeper queue. The venue has no user cancel. | Wait, and keep polling. Do not resubmit. |
| `pending-past-delay` | Still pending after the 180-second `maxTimeDelay`. | Keep polling. After 30 minutes, send CallPut the request key and the transaction hash. |
| `cancelled` | Keeper outcome. No position. The 0.00006 ETH fee is not assumed refundable. | Check the USDG balance on the explorer to see whether collateral returned, record it, and revoke the allowance. |
| `executed-balance-unconfirmed` | The getter says Executed, but the option-token balance does not cover `sizeOut` yet. | Not a fill. Recheck. If it persists, check the AAPL option token balance of the signer on the explorer and send me the key. |
| Request key lost | The panel stores it in browser storage only. | Open the open-transaction receipt on `https://robinhoodchain.blockscout.com` and read the `GenerateRequestKey` log from PositionManager. The key is the second indexed topic. |
| `executed-balance-confirmed` | Filled. | Record `optionTokenId`, `sizeOut`, `amountOut`, `executionPrice` and the USDG balance before and after. Do not close it until you approve a separate close packet. Expiry settlement also needs its own packet. |
| Wrong signer or network by mistake | Wallet shows something different from the packet. | Reject in the wallet. Nothing is sent. |

## 8. Unsupported and disabled

Automated or agent-initiated orders, CallPut Account relay and sessions, standalone single-leg Protective Put, close and settle execution, and any signing in the production deployment. They stay disabled until CallPut's written permission, or a separate packet for each, exists.
