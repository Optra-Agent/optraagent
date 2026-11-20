/**
 * External and engineering gates for autonomous venue orders.
 * Every line is a requirement that is not built yet. Nothing here can submit a real-money transaction.
 */
export const LIVE_REQUIREMENTS: readonly { title: string; note: string }[] = [
  { title: "Written venue permission and an owner-specific grant", note: "CallPut's automation permission and the actual owner's account/session grant must be verified." },
  { title: "Venue-enforced, revocable session limits", note: "Order scope, spend caps, expiry and revocation must be enforced by the venue account." },
  { title: "Durable request monitoring and an emergency stop", note: "Pending, executed and cancelled requests need persistent recovery and a tested stop path." },
  { title: "Independent audit and legal approval", note: "The exact execution scope needs independent review and jurisdiction approval." },
  { title: "An authorized order-to-settlement trial", note: "Open, close and expiry settlement must be exercised and reconciled for the selected account type." },
];
