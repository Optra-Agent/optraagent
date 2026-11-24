# OPTRA — Autonomous Live Agent: validation and activation checklist

Updated 24 Nov 2026, 09:44 UTC (16:44 WIB), Batch 03 pre-release snapshot. The last production baseline was verified read-only against Railway service `opetra` (`6876c674-9299-4822-8c3b-fdbab34f5995`) in project `OPTRA` / Production: deployment `d3695933-4069-4e7c-b3ae-266bf042d4a0`, `SUCCESS`, full `meta.commitHash` `4797eedd9ed27e1b66dafb3fa3953dd216a38ce8` on `main`. Candidate release, CI and deployment were not yet run at this timestamp. Local verification: 86 test files passed / 2 skipped; 643 tests passed / 2 skipped; lint, typecheck and production build passed on Node 26.12.1 / Bun 1.3.14. Authenticated G7 browser test passed 1/1 against the isolated local app/PGlite database with a generated throwaway wallet; its persisted test acknowledgement is not the owner's production acknowledgement. A fresh isolated fork pinned at block 122119407 (hash `0x5e1b5ff78bbd7d98be5344ab2c6e69dc555b509a1751d49ec89a84271dbc47d9`) passed 25/25. No production setting/data/wallet was changed, no production protected database evidence was read, no contract was deployed, and the separate recording session/fork on port 8561 was left untouched.

## Batch 03 — integrated engineering status versus activation eligibility

| Gate | Engineering verification | Actual activation status |
|---|---|---|
| G1 Venue | Evaluator/reporting integrated; current evidence inventory remains 3/12 verified, 6 partial, 3 open | BLOCKED: written CallPut permission, current source/upgrade evidence, real lifecycle evidence and owner sign-off are absent |
| G2 Custody | Owner-bound grant checks and configured Account observations are integrated; no signer is wired | BLOCKED: current resolver-selected Account, exact bounded grant enforcement, owner grant and independent audit are unverified |
| G3 Global controls | Deployment/process switches, durable owner stop and lease-aware rechecks are integrated | BLOCKED: keep `LIVE_TRADING_ENABLED=false`; other gates are unmet |
| G4 Wallet allowlist | Exact connected-wallet comparison/reporting is integrated | BLOCKED: no owner wallet is presumed or newly allowlisted |
| G5 Jurisdiction | Trusted-source refresh and fail-closed worker checks are integrated | BLOCKED: counsel policy and trusted production source are not approved/configured |
| G6 Paper history | Genuine current-recipe decisions and settled-expiry evidence are evaluated by the shared gate logic | BLOCKED: seven full days, a genuine evaluated decision and a settled expiry remain unverified; age-only earliest point is `2026-11-28T23:28:28.066Z` |
| G7 Risk acknowledgement | Current-version acknowledgement persistence/reporting is integrated; isolated browser test passed | BLOCKED for production owner: no owner-specific acknowledgement was read; the throwaway test-wallet record is not owner evidence |

Fork discrepancy: the unpinned port-8561 captures differed (20/25 and 25/25) because the acceptance harness selected the actor's latest plan instead of the plan for the submitted request; the harness now passes the request-associated plan to the keeper. A separate pinned attempt at block 122102881 on port 8562 failed before assertions because the upstream RPC could not supply required historical state; it is not a test failure or a pass. The fresh isolated block-122119407 run passed 25/25 without weakening assertions. The fork chain state was pinned, but plan and keeper inputs used live option-market data rather than a saved fixture. See `docs/evidence/callput/live-agent-fork-acceptance-20261124-pinned-122119407.log`.

Overall Live Agent activation remains **BLOCKED / NOT ELIGIBLE**. The release can be a safe engineering deployment with the execution switch off; it does not satisfy or waive owner, venue, counsel, custody/audit, scheduler, or seven-day Paper requirements. The completion report records the later exact candidate/CI/deployment outcome.

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
|| Fork acceptance | Historical unpinned 25/25 is not release-grade; the unpinned 20/25 discrepancy was traced to plan misassociation. Fresh isolated block-pinned run passed 25/25; the separate 122102881 fork was unavailable before assertions. This is not a live trade. | `docs/evidence/callput/live-agent-fork-acceptance-20261124-pinned-122119407.log`; historical capture: `docs/evidence/callput/live-agent-fork-acceptance-20261124.log` |
| Hard caps | Engine hard caps in `lib/venue/callput-live-agent-limits.ts` plus PM beta caps in `lib/live/gates.ts` ($100 capital per agent, $300 new exposure per user per day, 1 live agent per user, $25 maximum premium per position, no naked shorts) | code |

Integration facts that matter for activation:
- The only entry point to the worker is `POST /api/cron/live-agent`. It needs `CRON_SECRET` and an external caller. The House Agent scheduler runs in-process and does **not** run the Live Agent worker.
- The route returns `disabled` unless `LIVE_TRADING_ENABLED=true`. No production signer or submission route is wired. The setting remains false until venue authorization and custody gates are satisfied.
- Only Protective Put has a proposed BuyPutSpread mapping, inert without `LIVE_MAPPING_APPROVAL_REF`; it accepts only a running owner-owned agent (or public House Agent), a recent non-error open decision made with the current recipe hash, and the worker still requires all seven gates before asking for a plan.
- The authenticated status response returns the current owner-specific G1–G7 report in scheduled-worker context, the same evaluator used by the worker, along with the owner's stop, lease, grants and requests. It does not claim that configured factory getters prove current resolver/source enforcement.
- This candidate also hardens lease-aware stop/revocation and durable reconciliation monitoring, accurate readiness, and cron authentication smoke coverage. Local tests/build passed; pinned-SHA CI and the production release remain pending at the timestamp above.

## 2. Activation checklist (status and blockers; do not skip an item)

### A. Engineering status at the Batch 03 pre-release timestamp above
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

## 3. Batch 03 pre-release verdict
Live Agent readiness: **BLOCKED; not activatable**. At the timestamp above, the verified production baseline had `liveTradingEnabled: false` and `v4ClaimLevel: L0`; no owner session was created to read private production gates. The candidate was locally verified but not yet committed, CI-validated or deployed at that timestamp. G1–G7 engineering reporting is integrated, but actual activation remains blocked by the owner, venue, counsel, audit/custody, scheduler and time-dependent requirements above. The final release completion report supplies the subsequent commit and deployment evidence.

## 4. Batch 02 — G6/G7 engineering checkpoint (24 Nov 2026)

Engineering implementation is complete for G6 and G7. G1–G5 were not reopened or changed.

- G6 reads only the authenticated owner's private agents and the explicitly supported public House Agents; a named agent reference resolves to that exact agent. Eligible decisions must be after launch, no later than evaluation time, error-free, and match the agent's current recipe hash. A settled expiry counts only from a filled Paper `expiry_settlement` order tied to the same agent, current-recipe decision and tick, and the matching closed position with consistent expiry and close timestamps. Mutable account settlement counters alone do not pass G6. The same evaluator recalculates readiness on authenticated status reads and worker checks.
- G7 uses one shared exact-set validator for the current wording version and the three required statement IDs, each exactly once. The authenticated owner is the persistence key; the same evaluator feeds the gate report and existing Enable live UI. Missing, stale, incomplete, duplicate, extra, and unauthenticated submissions remain closed.
- Targeted verification: 35 unit/integration/UI tests passed across `tests/live/gates.test.ts`, `tests/integration/live-gates-db.test.ts`, and `tests/app/live-gates-panel.test.ts`; authenticated G7 browser flow passed 1/1 using an isolated local database and throwaway test wallet; `bun run lint` and `bun run typecheck` passed. No full suite, CI, production write, production gate read, switch change, wallet action, signer provisioning, or deployment was done in Batch 02.

Activation remains blocked. No production Paper history or owner acknowledgement was read or created. The existing House Agent launch timestamp is `2026-11-21T23:28:28.066Z`, so seven full days are not elapsed as of 24 Nov 2026; the earliest age-only point remains `2026-11-28T23:28:28.066Z`. After that, genuine current-recipe evaluations and a persisted post-expiry Paper settlement must still be present. The owner must personally review and submit all current-version risk statements in the authenticated UI for G7. Keep real-money execution disabled until every gate and external prerequisite is genuinely satisfied.
