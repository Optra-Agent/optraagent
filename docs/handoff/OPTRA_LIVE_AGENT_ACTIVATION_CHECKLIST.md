# OPTRA — Autonomous Live Agent: validation and activation checklist

Updated 24 Nov 2026, 07:13 UTC (14:13 WIB), after Batch 01. The last confirmed production baseline remains `4797eedd9ed27e1b66dafb3fa3953dd216a38ce8` on Railway service `opetra` (`d3695933-4069-4e7c-b3ae-266bf042d4a0`); this batch made no production changes. Focused verification: 103 tests passed across eight files; lint and typecheck passed. Full suite, build, CI, and deployment were intentionally not run in this batch. The current fork lifecycle results conflict (20/25 and 25/25); do not treat the latter alone as deterministic acceptance. No production setting, wallet, funding, signature, transaction, or protected database evidence was changed or accessed.

## Batch 01 checkpoint — G1–G5

- G1 evidence evaluation remains fail-closed: all venue checklist items and owner sign-off are required. Only 3 of 12 items are verified; CallPut confirmation and owner actions below remain outstanding.
- G2 engineering reads the exact grant Account from the configured factory, checks its owner association, and keeps resolver/source/enforcement verification false until proven. The signer submitter remains injected-only; production has no signer route. Venue permission, owner-signed grant, and independent audit remain external.
- G3 combines the deployment switch, process kill switch, durable owner stop, and worker gate re-evaluation. Live execution remains disabled.
- G4 compares the authenticated wallet against the exact configured allowlist entry and reports it in the owner-specific gate report. No production allowlist change was made.
- G5 now has an authenticated jurisdiction-refresh API route. It stores only country/source/timestamps/current policy reference on that owner's unrevoked grant, expires after 15 minutes, rejects blocked countries, and never uses cron-caller location or risk-ack country. Production source configuration and counsel policy remain unverified.
- Targeted commands: `bunx vitest run tests/live/gates.test.ts tests/live/geo.test.ts tests/options/callput-account-gates.test.ts tests/app/live-agent-controls.test.ts tests/integration/callput-live-agent-worker.test.ts` (82/82); `bunx vitest run tests/app/live-agent-configure.test.ts tests/app/live-agent-journey.test.ts tests/options/callput-wallet-readiness.test.ts` (21/21); `bun run lint`; `bun run typecheck`.
- Commit: recorded in this batch's source commit; SHA is listed in the final report. No CI, production deployment, or activation was performed.

## 1. Historical validation evidence (not rerun in Batch 01)

| Area | Result | Evidence |
|---|---|---|
| Public status | Engine "Engine built · Live activation required"; live execution "Acceptance required"; `liveTradingEnabled: false`; `v4ClaimLevel: L0`; no OPTRA order is described as a fill | `/api/public/v1/verify`, `/tape` rendered signed out |
| Access control | Owner-facing status and `/api/live/gates` require a wallet session; cron route requires `CRON_SECRET`; unauthenticated and safely-disabled cron behavior is covered by the image smoke test | `bun run test` 638 passed / 2 skipped; pinned-SHA CI pending |
| Risk gates | One evaluator (`lib/live/gates.ts`) feeds authenticated owner status and the scheduled worker; missing/unknown facts fail closed, including scheduled G5 and missing owner-stop state | Full test suite; authenticated G7 browser test; typecheck and lint passed |
| Engine logic | Owner-scoped grants and Paper history, current-recipe decision mapping, hard spending limits, idempotency, expiring lease, pre-submit switch/stop recheck, durable reconciliation, emergency stop and monitoring | Full test suite; isolated Mainnet-fork acceptance 25/25; pinned-SHA CI pending |
| Account evidence | Configured factory getters are displayed as observations only; resolver, source and per-open enforcement are explicitly unverified and G2 remains blocked | account-gate and UI regression tests |
| Browser acceptance | Authenticated G7 flow, persistence, blocked gates, and no transaction methods exercised with a throwaway signer against the isolated test server | `OPTRA_E2E_PORT=3140 bun run test:e2e tests/e2e/live-gates.spec.ts` — 1 passed |
|| Fork acceptance | A captured run reports 25/25 on Robinhood Mainnet fork, chain 4663; two later run results conflict at 20/25 and 25/25, so repeatability is unresolved; not a live trade | `scripts/callput-live-agent-fork-acceptance.ts`; captured run: `docs/evidence/callput/live-agent-fork-acceptance-20261124.log` |
| Hard caps | Engine hard caps in `lib/venue/callput-live-agent-limits.ts` plus PM beta caps in `lib/live/gates.ts` ($100 capital per agent, $300 new exposure per user per day, 1 live agent per user, $25 maximum premium per position, no naked shorts) | code |

Integration facts that matter for activation:
- The only entry point to the worker is `POST /api/cron/live-agent`. It needs `CRON_SECRET` and an external caller. The House Agent scheduler runs in-process and does **not** run the Live Agent worker.
- The route returns `disabled` unless `LIVE_TRADING_ENABLED=true`. No production signer or submission route is wired. The setting remains false until venue authorization and custody gates are satisfied.
- Only Protective Put has a proposed BuyPutSpread mapping, inert without `LIVE_MAPPING_APPROVAL_REF`; it accepts only a running owner-owned agent (or public House Agent), a recent non-error open decision made with the current recipe hash, and the worker still requires all seven gates before asking for a plan.
- The authenticated status response returns the current owner-specific G1–G7 report in scheduled-worker context, the same evaluator used by the worker, along with the owner's stop, lease, grants and requests. It does not claim that configured factory getters prove current resolver/source enforcement.
- This candidate also hardens lease-aware stop/revocation and durable reconciliation monitoring, accurate readiness, and cron authentication smoke coverage. Local tests/build passed; pinned-SHA CI and the production release remain pending at the timestamp above.

## 2. Activation checklist (status and blockers; do not skip an item)

### A. Historical engineering status (deployment state at the original timestamp above)
1. Production signer wiring remains absent by design. Do not build it until CallPut confirms the current Account model and an independent audit verifies the exact grant fields, custody and revocation behavior. The 2026-11-22 sample had inferred field names and several unbounded values; do not copy or sign it.
2. The cron route returns a monitoring summary and reports durable unresolved requests when enabled. No external scheduler caller, production `CRON_SECRET`, or alert destination is verified. Configure none while mandatory gates are unmet.
3. G5 code accepts only a configured trusted edge-overwritten header or server-side IP lookup on the authenticated jurisdiction-refresh request. A fresh owner-bound proof is stored on that owner's unrevoked grant for at most 15 minutes and is validated against the current policy on every worker tick. The cron caller's location and saved acknowledgement country are ignored. Production geo configuration and counsel's final policy remain unverified.
4. `docs/runbooks/live-agent-operations.md` now documents stop/drain, unknown requests, monitoring and owner/venue actions. Authenticated Enable-live e2e without the owner's wallet remains unverified.
5. Only the proposed Protective Put-to-BuyPutSpread route is implemented, and it is inert without `LIVE_MAPPING_APPROVAL_REF`; other House strategies and automated closing/settlement remain outside this open-only worker path.

### B. Owner-signed wallet actions (agents never do these)
1. Only after CallPut confirms the current Account flow and applicable terms, create and fund the owner's exact Account from the owner's wallet; verify the resolver-selected factory gates for that Account.
2. Only after CallPut supplies the exact current grant schema and an independent audit verifies bounded enforcement, the owner signs the narrow session grant and records its on-chain reference. Never copy the 2026-11-22 sample with inferred/unbounded fields.
3. The owner separately approves and performs the minimal Mainnet open, close and settle for V12. Record actual request, fill, position-balance and settlement evidence; a hash, fork result or pending request does not count.
4. The owner acknowledges all three current-version risk statements (G7). After G2 passes, the operator adds the exact owner wallet to `LIVE_WALLET_ALLOWLIST` (G4).
5. The owner verifies and signs CallPut's actual session revoke/recovery workflow; OPTRA's database stop/revoke is not venue revocation.

### C. CallPut venue confirmations (written, from CallPut)
1. Written CallPut answers must confirm: OPTRA automated open/close/settle permission; whether an operator-held device/session signer is supported; exact grant schema and on-chain-enforced underlying/strategy/amount/gas/expiry limits; relay custody and pending/partial/cancel behavior; owner revoke/recovery semantics; applicable terms, jurisdiction, polling/rate limits and support; current source/upgrade/audit status.
2. V1, V3, V5, V6, V7 and V11 remain partial; V9, V10 (historical premium/IV data) and V12 (owner's real lifecycle) remain open. Only V2, V4 and V8 are fully verified: 3 of 12.
3. After all V1–V12 are independently verified, the owner records `LIVE_VENUE_SIGNOFF_REF`.

### D. Audit and custody requirements
1. Independent audit of the account contracts and of the signer custody design before any operator-held key exists.
2. Counsel decides the final jurisdiction list (the built-in list is provisional: US, CU, IR, KP, SY).
3. Approve the decision-to-order mapping and record `LIVE_MAPPING_APPROVAL_REF`.

### E. Time-dependent Paper Trading acceptance (cannot be sped up)
1. G6 requires at least 7 full Paper days, one genuinely settled expiry cycle and at least one genuine evaluated decision. The recorded House Agent launch is `2026-11-21T23:28:28.066Z`; the earliest seven-day point is `2026-11-28T23:28:28.066Z`.
2. The last usable public Tape snapshot recorded 20 decisions: 16 genuine evaluations and 4 `system.market_data` errors. Exclude the four errors. No authenticated settled-expiry evidence was available in that snapshot. Wait for the real clock, query genuine production counters after eligibility, and never seed, edit or backdate Paper history or settlement evidence.

### F. Last step (operator only, after A to E pass)
Set `LIVE_TRADING_ENABLED=true` on Railway. The worker then re-evaluates G1 to G7 itself; a screen showing green is not enough. Keep `V4_CLAIM_LEVEL=L0`. Emergency stop: the Stop control in `/tape#live-agent` (`POST /api/venue/callput/live-agent/stop`) and setting the switch back to false.

## 3. Historical verdict (pre-release snapshot)
Live Agent readiness: **BLOCKED; not activatable**. At the timestamp above, the last confirmed production baseline had `liveTradingEnabled: false` and `v4ClaimLevel: L0`; no owner session was created to read private production gates. The candidate is locally verified but not yet deployed at that timestamp. G1–G7 and external, owner, CallPut, counsel, audit and time-based blockers remain as listed above; the release report records the eventual commit and deployment outcome.
