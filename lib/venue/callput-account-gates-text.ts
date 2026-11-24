/** Client-safe description of observed CallPut account-factory reads; no chain access or inferred admin remedy. */
export type AccountGateFacts = {
  /** Factory address used by this read; the caller did not verify it through CallPut's live resolver. */
  factoryAddress?: string;
  /** Independent provenance checks; missing is treated as unverified. */
  /** The configured factory associates this exact Account with the supplied owner or its predicted Account. */
  ownerAccountMatch?: boolean;
  resolverMatchVerified?: boolean;
  factorySourceVerified?: boolean;
  accountSourceVerified?: boolean;
  openPathEnforcementVerified?: boolean;
  openToAll: boolean;
  safeMode: boolean;
  account: string;
  accountCreated: boolean;
  accountRegistered: boolean;
  accountAllowed: boolean;
  accountCanOpen: boolean;
  ownerAccountCount: number;
  /** True only when canOpen and current resolver/source/per-open enforcement are all verified. */
  accountUsable: boolean;
};

/** Conservative operator guidance. Getter output is an observation, not proof of the source or Account enforcement. */
export function accountBlockReason(facts: AccountGateFacts): string | null {
  const unverified = [
    ["owner Account association", facts.ownerAccountMatch],
    ["current resolver match", facts.resolverMatchVerified],
    ["factory source", facts.factorySourceVerified],
    ["Account implementation source", facts.accountSourceVerified],
    ["per-open enforcement", facts.openPathEnforcementVerified],
  ].filter(([, verified]) => verified !== true).map(([item]) => item);
  const verificationNote = unverified.length > 0
    ? ` ${unverified.join(", ")} ${unverified.length === 1 ? "is" : "are"} not verified; this getter result does not establish current venue enforcement. Confirm the resolver and required action with CallPut.`
    : "";
  if (facts.accountCanOpen) return unverified.length > 0
    ? `Configured factory reports canOpen=true for Account ${facts.account}${facts.factoryAddress ? ` at ${facts.factoryAddress}` : ""}, but ${verificationNote.trimStart()}`
    : null;
  const observed = `Configured factory reports canOpen=false for Account ${facts.account}${facts.factoryAddress ? ` (configured address ${facts.factoryAddress})` : ""}.`;
  if (facts.safeMode) return `${observed} It also reports safe mode=true.${verificationNote} Do not infer funding or admin remedies; confirm the current resolver and required action with CallPut.`;
  if (!facts.accountCreated) return `${observed} The configured factory reports that the Account does not exist yet.${verificationNote} Please re-read the exact Account and confirm the current creation workflow with CallPut before acting.`;
  if (!facts.accountRegistered) return `${observed} The configured factory reports this Account is not registered.${verificationNote} Confirm the current registration requirements with CallPut before acting.`;
  if (!facts.accountAllowed) return `${observed} The configured factory reports this Account is not allowlisted.${verificationNote} Confirm the current allowlist requirements with CallPut before acting.`;
  return `${observed} The exact Account is created, registered and allowlisted, but the getter result does not establish why open eligibility is false or whether the open path enforces it.${verificationNote} Confirm the current resolver and required action with CallPut; do not infer that funding or admin action is required.`;
}

export function describeAccountGates(facts: AccountGateFacts): string {
  const verified = (value: boolean | undefined) => value === true ? "verified" : "not verified";
  return `configured factory reports safe mode ${facts.safeMode ? "on" : "off"}, open to all ${facts.openToAll ? "yes" : "no"}, Account ${facts.account} created ${facts.accountCreated ? "yes" : "no"}, registered ${facts.accountRegistered ? "yes" : "no"}, allowlisted ${facts.accountAllowed ? "yes" : "no"}, canOpen ${facts.accountCanOpen ? "yes" : "no"}${facts.factoryAddress ? ` at ${facts.factoryAddress}` : ""}; owner Account association ${verified(facts.ownerAccountMatch)}, resolver match ${verified(facts.resolverMatchVerified)}, factory source ${verified(facts.factorySourceVerified)}, Account source ${verified(facts.accountSourceVerified)}, per-open enforcement ${verified(facts.openPathEnforcementVerified)}`;
}
