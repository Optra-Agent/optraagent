# CallPut Robinhood Mainnet write-integration request

To: CallPut engineering / integrations
Subject: Verified Robinhood Mainnet wallet-signed options integration for OPTRA

OPTRA is implementing a user-authorized Robinhood Chain options interface against CallPut. We will not submit, sign, relay, or broadcast a live order until the write ABI, account authorization, amount units, delegation policy, and settlement lifecycle below are confirmed. Please answer against the currently deployed Robinhood Mainnet contracts and attach the versioned ABI/source references and a minimal test fixture.

## 1. Deployment identity and exact write ABI

Please confirm the current chain ID, proxy addresses, proxy type, implementation addresses/version, and verified source/ABI for each contract involved in opening, closing, cancelling, and settling an options position. In particular, confirm whether these repository-configured addresses are current:

- PositionManager: `0x426a6b482893557E58cF38de635fEbB30Fd6a3C3`
- OptionsMarket: `0x3271d35afAc70C0D4989F984Abb2d918bf672C7e`
- Controller: `0x0D240c1EbEeE7F74B40d6611326f5df98AB00e1B`
- TradingAccountFactory (current, per CallPut's resolver; proxy): `0x23DB9f5fDde30853EC8eBd75E0492c09505a6D1d`. The earlier `0xbcaC622Bb396B2f868b37D7C41F34695c9be1862` is the superseded factory.
- TradingAccount beacon: `0x5685d4DD5114c74C805322d4612CA5D73EAcdc62`
- SettleManager: `0xd328D581f3Fb1Ca86D28D573bA1f17409e5112EF`

For every supported write, please provide the exact Solidity signature and ABI tuple, required `msg.value`, token approvals and spender, required preconditions, return values, emitted events, and the canonical transaction ordering. Include the exact read methods used to retrieve each request by key. Please identify any write that is not supported for third-party integrations.

## 2. TradingAccount creation, ownership, and caller authorization

For open, close, cancel, and settlement actions, is the authorized caller the user's EOA, the user's TradingAccount, an approved router/controller, or another address? Please specify:

- How an EOA maps to its TradingAccount and how the account is created (if creation is required).
- Which address is stored as the request's `account` and which address must be `msg.sender` at every stage.
- Whether direct wallet calls are supported, and what changes when a call is forwarded through an OPTRA contract or smart account.
- The exact owner/operator/delegate checks and whether approvals are per action, per market, or global.
- Whether any controller, operator, session-key, or relayer must be allowlisted by CallPut.

A transaction receipt is not sufficient evidence of a fill. Please identify the authoritative on-chain state/event that distinguishes accepted, pending, cancelled, executed, rejected, expired, and settled requests.

## 3. Amount units, bounds, and fee semantics

Please define the unit, scale, and valid range for every input and output, including `amountIn`, `minSize`, `size`, `minAmountOut`, `minOutWhenSwap`, `sizeOut`, `amountOut`, `executionPrice`, expiry, and any option-token identifier. Confirm:

- USDG and native-token decimals, token/option-size multipliers, collateral denomination, and rounding direction.
- The meaning and source of `underlyingAssetIndex`, option-token IDs, expiry timestamps, and minimum order sizes.
- Whether `minOutWhenSwap` is a token amount, a slippage bound, or another value, and which asset it constrains.
- The required allowance/deposit path and whether flags such as `isDepositedInNAT` and `withdrawNAT` change the asset received or spent.
- The current `executionFee` and `maxTimeDelay` values, their units, who receives the fee, when it is charged/refunded, and the behavior when a request is not processed within the delay.

Please give one non-broadcast example for a minimal supported open and close request with every value labeled in human and raw units. Do not use a live user's account or require a Mainnet transaction.

## 4. Delegation and wallet-signing model

Please confirm the supported signing model for a non-custodial application where each user controls their own wallet. Can a user sign the exact CallPut call directly from their EOA, with no OPTRA contract? If not, what exact delegation primitive is supported (for example, an approved TradingAccount operator, smart-account module, or session key), how is it installed/revoked, and what authority does it grant?

Please state explicitly whether an OPTRA-owned controller contract is permitted and technically necessary. If forwarding changes the authorized `msg.sender`, specify the supported route and its restrictions. We will not add a controller or proxy based on an assumed authorization model.

## 5. Automation and integration permissions

Please confirm in writing whether CallPut permits OPTRA to:

- Prepare calls locally and present them for an end-user wallet signature.
- Poll public on-chain request getters/events for the user's account and display request status.
- Operate user-approved automation through a documented delegation mechanism, including the allowed open/close/cancel/settle actions and revocation path.

Please include applicable terms/policy limits, API/RPC rate limits, event/indexing guidance, required attribution, and any user-consent or disclosure requirements. Please distinguish permission to display public on-chain data from permission to operate an automated trading agent.

## 6. Request, fill, expiry, and settlement lifecycle

Please provide the authoritative state machine and event sequence from request submission through processing and final settlement. Define each status value and these fields: `blockTime`, `processBlockTime`, `sizeOut`, `amountOut`, and `executionPrice`. Confirm whether a successful request transaction can remain pending or later be cancelled, and what constitutes final fill evidence.

For expiry and settlement, please specify:

- The exact SettleManager/OptionsMarket methods, caller permissions, and required arguments.
- Who may trigger settlement, when it becomes callable, and whether it is permissionless or keeper-only.
- How expiry/settlement price is selected, how payouts and residual collateral are calculated, which token is paid, and how the TradingAccount balance changes.
- The expected lifecycle for worthless, in-the-money, partially processed, stale, failed, and delayed requests, including recovery actions.
- How OPTRA should avoid showing a transaction receipt as a completed trade before the canonical settlement/fill state is reached.

## 7. Safe verification path

Please provide a supported non-Mainnet environment, deterministic fork fixture, or view-only simulation procedure that exercises the confirmed ABI, caller authorization, request lifecycle, and unit conversions without moving real funds. If no such environment exists, please identify the safe validation procedure CallPut recommends before a user signs a Mainnet transaction.

## Current read-only observations to confirm

OPTRA's existing read-only Mainnet check targets chain ID `4663`. A direct read of `openPositionRequests(bytes32(0))` returned 14 zero-valued fields, and `closePositionRequests(bytes32(0))` returned 13 zero-valued fields. Please confirm whether a zero `blockTime` with status `0` is the canonical representation for an absent request, and whether the current status mapping `0 = Pending`, `1 = Cancelled`, `2 = Executed` is correct.

Please reply with the versioned ABI/source links, an authorization diagram or precise caller matrix, a units table, the lifecycle/state diagram, automation permission terms, and the non-broadcast fixture. If any item is unsupported, please say so explicitly so OPTRA can keep that path disabled.
