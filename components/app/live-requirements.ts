/**
 * What Live trading needs before it can exist. Shared by the topbar and the landing so both say the same thing.
 * Every line is a requirement that is not built yet. Nothing here can submit a real-money transaction.
 */
export const LIVE_REQUIREMENTS: readonly { title: string; note: string }[] = [
  { title: "A verified options execution venue", note: "An adapter to a venue that lists the options Optra would trade, checked end to end." },
  { title: "Explicit wallet authorization", note: "You approve what an agent may do with your wallet, and can revoke it." },
  { title: "Enforced risk and transaction limits", note: "Limits that are enforced where the order is sent, not only shown on screen." },
  { title: "A real order lifecycle and settlement", note: "Orders, fills, cancellations, expiry and settlement tracked from the venue." },
  { title: "Transparent execution records", note: "Every real order recorded on Optra Tape the way paper decisions are today." },
];
