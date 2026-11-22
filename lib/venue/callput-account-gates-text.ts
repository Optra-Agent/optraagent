/** Client-safe description of the CallPut account-factory gates; no chain access. See callput-account-gates.ts for their meaning. */
export type AccountGateFacts = {
  openToAll: boolean;
  safeMode: boolean;
  account: string;
  accountCreated: boolean;
  accountRegistered: boolean;
  accountAllowed: boolean;
  accountCanOpen: boolean;
  ownerAccountCount: number;
  accountUsable: boolean;
};

/** The first reason the factory would refuse an open, in the order the factory checks them, or null when it would allow one. */
export function accountBlockReason(facts: AccountGateFacts): string | null {
  if (facts.accountCanOpen) return null;
  if (facts.safeMode) return "CallPut's factory is in safe mode, which blocks funding, registration and opens until CallPut's admin turns it off";
  if (!facts.accountRegistered) return "the Account is not registered with the factory yet (it registers when the owner funds it)";
  if (!facts.accountAllowed) return "the Account is not on CallPut's open allowlist and open-to-all is off, so CallPut's admin must allowlist it";
  return "the factory refuses opens for this Account";
}

export function describeAccountGates(facts: AccountGateFacts): string {
  return `safe mode ${facts.safeMode ? "on" : "off"}, open to all ${facts.openToAll ? "yes" : "no"}, Account ${facts.account} created ${facts.accountCreated ? "yes" : "no"}, registered ${facts.accountRegistered ? "yes" : "no"}, allowlisted ${facts.accountAllowed ? "yes" : "no"}, may open ${facts.accountCanOpen ? "yes" : "no"}`;
}
