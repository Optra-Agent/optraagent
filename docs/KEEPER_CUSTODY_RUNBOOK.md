# OPTRA P4 keeper custody and operations runbook

Status: engineering draft for owner approval. This file is not an approval record and does not satisfy `OPTRA_MAINNET_KEEPER_RUNBOOK_REF`. The reference becomes valid only after the owner completes section 9, approves it, and supplies the approved record's identifier. Nothing here signs, sends or funds anything.

## 1. What the keeper can and cannot do

- Address: `0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848` (EOA, no code). Read on Mainnet at 2026-11-21: balance 0, nonce 0, not a Safe owner, not the deployer, not the admin Safe.
- The only keeper function is `publishPolicy(bool pauseEntries)` on `OptraGuardHook`. It sets one bit and a timestamp.
- The hook holds no funds and has no function that moves assets, so a stolen keeper key cannot take user or treasury funds.
- A stolen or faulty keeper can publish "allow" when entries should be paused, which lets risk-increasing swaps (buying the underlying) through in OPTRA's own pool. It cannot block a configured-underlying sale.
- Freshness: the policy expires after 300 seconds. When it is missing, stale or paused, risk-increasing swaps revert. Selling the underlying stays allowed by design. A dead keeper therefore fails closed for buys.
- The admin Safe can call `setKeeper(newKeeper)` (clears the policy; rejects the admin address) and `revokeKeeper()`. Only the Safe can do this; no engineering process holds those rights.

## 2. Custody requirements

1. A dedicated key used for nothing else. Never reuse the deployer, a Safe owner key, or a personal wallet.
2. The key must be able to sign unattended at least every 240 seconds, so it is a hot key. Prefer a cloud KMS or HSM signing key (the private key never leaves it) over a key file. If a key file is used, it lives only in the operator's secret manager, never in the repository, CI, container image, build argument or Railway variable shared with the web app.
3. The keeper signing service runs separately from the OPTRA web service, with its own credentials. The web service never holds the keeper key.
4. The keeper address is funded only with gas (section 5). It never holds USDG or other assets.
5. Two named people can disable the signer: the operator and one backup. Their contact route is recorded in section 9.
6. Key creation, backup and destruction are logged by the operator. Backups, if any, are encrypted and not co-located with the running service.

## 3. Policy source

The hook takes one bit. This runbook does not choose the signal that sets it, because that is a product and risk decision the owner has not recorded. Until the owner records an approved signal, the only safe behavior is: publish `pauseEntries = true` (entries paused) and never publish `false`. A publisher must refuse to publish `false` unless section 9 names the approved signal and a second person has enabled it.

## 4. Publishing cadence and fail-safe behavior

- Heartbeat every 240 seconds (80% of the 300-second window), plus an immediate publish on any bit change.
- Before each publish: confirm chain ID 4663, read `isPolicyFresh()` and `entryPaused()`, and confirm the signer address equals the keeper address on the hook (`keeper()`).
- On any RPC failure, mismatch or unexpected state, do not publish an allow. Let the policy expire.
- Never publish from two instances. Use a single-flight lock with expiry.
- A publish transaction that is pending or unknown after 120 seconds raises an alert and blocks a second publish for the same bit until the first resolves.

## 5. Funding and cost

`publishPolicy` costs about 30,000 execution gas in the unit-test gas report (median 29,044; maximum observed 128,776 on first write), plus the 21,000 base cost and chain-specific data fees that were not measured. Planning figure: 60,000 gas per publish. At the observed 20,004,000 wei gas price that is about 0.0000012 ETH per publish. At 360 heartbeats per day, about 0.00043 ETH per day, about 0.013 ETH per month. Recompute from a real receipt after the first publish. Funding the keeper is a separate transfer the owner must approve; none has been made. Alert when the balance covers less than 3 days.

## 6. Monitoring and alerts (read-only commands)

Replace `<HOOK>` with the deployed hook address once it exists. Use the owner-approved RPC (`https://rpc.mainnet.chain.robinhood.com`) and verify the chain ID first.

```sh
cast chain-id --rpc-url "$OPTRA_MAINNET_RPC_URL"
cast call <HOOK> 'keeper()(address)' --rpc-url "$OPTRA_MAINNET_RPC_URL"
cast call <HOOK> 'isPolicyFresh()(bool)' --rpc-url "$OPTRA_MAINNET_RPC_URL"
cast call <HOOK> 'entryPaused()(bool)' --rpc-url "$OPTRA_MAINNET_RPC_URL"
cast balance 0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848 --rpc-url "$OPTRA_MAINNET_RPC_URL"
```

Alert on: policy not fresh for more than 60 seconds; keeper balance under 3 days of gas; a `KeeperChanged` event; a `PolicyPublished` event whose `keeper` or timing is unexpected; publish gas more than twice the baseline; chain ID other than 4663; two publishes inside one heartbeat; the signer service unreachable.

## 7. Rotation, revocation and incident response

- Suspected key compromise, or a wrong allow published: the admin Safe operator reviews and, if approved, signs `revokeKeeper()`. This clears the policy and leaves risk-increasing swaps blocked. Disable the signing service first. Details: `docs/INCIDENT_RESPONSE.md`.
- Planned rotation: create the new key under section 2, fund it, verify the address independently, then the Safe signs `setKeeper(newKeeper)`. The new keeper publishes a pause policy first. Retire the old key's KMS permission after the Safe transaction confirms.
- Read back after any Safe action: `keeper()`, `isPolicyFresh()`, `entryPaused()`.
- Keeper outage: no action is required for safety. Buys revert once the policy ages out. Restore the signer, then publish pause before any later allow.
- Rehearse revocation on a fork before go-live and record the result.

## 8. What this runbook does not cover

Pool initialization, liquidity, the choice of the allow/pause signal, legal eligibility, the Safe's own owner controls, and any CallPut order or Live Agent activity.

## 9. Owner completion block (not completed)

| Field | Owner entry |
|---|---|
| Keeper operator (person or organization) | OWNER TO COMPLETE |
| Backup operator | OWNER TO COMPLETE |
| Custody method (KMS/HSM product, or secret manager) and who can access it | OWNER TO COMPLETE |
| Approved allow/pause signal and the second approver | OWNER TO COMPLETE |
| Alert destination and on-call contact | OWNER TO COMPLETE |
| Funding source and monthly gas budget | OWNER TO COMPLETE |
| Revocation rehearsal record (fork transaction or log) | OWNER TO COMPLETE |
| Approval record identifier and date | OWNER TO COMPLETE |
