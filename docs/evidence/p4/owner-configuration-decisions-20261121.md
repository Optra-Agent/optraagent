# OPTRA P4 owner configuration decisions (session record, 2026-11-21)

Recorded from the Project Owner's message in the engineering session. These are project configuration decisions and an acknowledgement of real Mainnet fees. They are not authorization from the Safe owners, independent auditors, issuers, venues or legal counsel, and they are not approval of any transaction.

| Decision | Value |
|---|---|
| Network | Robinhood Mainnet, chain ID 4663 |
| Asset pair | Native ETH (`address(0)`) / USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 decimals) |
| Pool | New hook-specific pool, static fee 3000 (0.30%), tick spacing 60 |
| Maximum policy age | 300 seconds |
| Production RPC | `https://rpc.mainnet.chain.robinhood.com`. A public endpoint with no stated service level; the owner designated it for production use |
| Deployer | `0xAa8fDF2f96aFC037D50659CFd09fDF3Fac060bBf` |
| Keeper | `0x23439a41eDC01D58d3Aaa0C75E9dFEE0C0196848` (the owner's message used different letter casing for the same 20 bytes; the lowercase form is identical) |
| Admin and pool creator (proposed) | Safe `0xf9C76ef996C5cbC73E4E23927D6EecB3295c8d45` |
| Mainnet acknowledgement | The owner acknowledged this is a real Mainnet deployment involving transaction fees |
| PM scope | The owner confirmed P4 scope alignment (spot swap-direction gate only; not CallPut execution) |

## Not provided by this record

- Consent of the Safe's owners (3 owners, threshold 2) to act as OPTRA admin and pool creator.
- Third-party eligibility of the asset pair and jurisdiction/legal determination for the intended users.
- A keeper operator, key-custody and runbook record.
- An independent security audit report and its SHA-256.
- Approval of a final transaction packet hash.
