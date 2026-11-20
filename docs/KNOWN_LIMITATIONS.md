# OPTRA Contract Known Limitations

Updated: 2026-11-20

Status: `OptraGuardHook` is an experimental candidate, not a production-approved or deployed contract. No OPTRA Mainnet address or receipt exists. These limitations apply regardless of passing local tests or fork simulations.

- The hook gates one direction of swaps through one future OPTRA-owned Uniswap v4 pool. It cannot control CallPut/Zeno options orders, third-party pools, other routes, wallet approvals, or user positions.
- The policy is one keeper-published boolean (`entryPaused`), not a complete onchain implementation of Haltr, Venux, Corpax, or Sessia. There is no authenticated session schedule, holiday/early-close calendar, corporate-action feed, venue-health proof, or options-position proof.
- `underlying-out` swaps are always permitted, even while policy is missing, stale, or paused. This is token direction only; it does not establish a position reduction, hedge, or options exit.
- The keeper can publish an incorrect allow policy while authorized. Admin revocation invalidates the policy, but the Mainnet Safe, keeper operator, monitoring, and recovery process are not selected or rehearsed.
- The pool creator chooses fee, tick spacing, initial price, and initialization timing. The hook does not validate a price oracle, slippage limit, liquidity depth, or market-quality threshold.
- Mainnet constructor checks require deployed code for manager/tokens/admin/creator, pin the manager address on chain ID `4663`, and require keeper/admin separation. They do not check the manager runtime hash or prove token identity/eligibility, Safe multisig threshold, or safe role ownership. A chain-4663 deployment script with hard guards does not exist.
- Token issuers may impose transfer restrictions or availability changes outside the hook. Asset-specific trading hours and legal/geographic eligibility require separate verification.
- `maxPolicyAge` has an immutable hard maximum of 900 seconds. The current engineering default is 300 seconds, but no Mainnet constructor tuple is approved.
- Contract configuration is immutable; there is no upgrade or admin-transfer function. A wrong configuration or code defect requires a replacement hook and a new pool.
- Internal Foundry, Slither, and fork checks are not an independent security audit. No independent audit is recorded.
- The Robinhood Mainnet fork test uses transient mock tokens and fork-local state. It does not deploy anything to Robinhood, validate a real Stock Token pool, prove a supported router route, or establish economic safety.
- No signer-specific Mainnet deployment simulation, exact transaction batch, gas ceiling, source verification, or final transaction approval exists.

Do not represent this contract as enabling CallPut execution, Live Options, custody, portfolio risk management, or Live Trading. `LIVE_TRADING_ENABLED=false` and `V4_CLAIM_LEVEL=L0` remain unchanged.