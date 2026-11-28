export type HarmonicRegistrationStatus =
  | "UNREGISTERED"
  | "REGISTERING"
  | "REGISTERED"
  | "ERROR";

export type HarmonicFilingMode = "PUBLIC_OPEN" | "SEALED" | "DISABLED";

export type HarmonicUnavailablePolicy =
  | "BLOCK_ACTION"
  | "ALLOW_WITH_UNVERIFIED_LABEL"
  | "PAUSE_AGENT";

export type HarmonicHorizon = "1h" | "4h" | "1d" | "7d";
export type HarmonicDirection = "up" | "down";

export type HarmonicTapeEventType =
  | "HARMONIC_REGISTRATION_REQUESTED"
  | "HARMONIC_REGISTERED"
  | "HARMONIC_EXPECTATION_CREATED"
  | "HARMONIC_EXPECTATION_FILED"
  | "HARMONIC_EXPECTATION_SEALED"
  | "HARMONIC_EXPECTATION_REVEALED"
  | "HARMONIC_EXPECTATION_FAILED"
  | "HARMONIC_VERIFICATION_REQUESTED"
  | "HARMONIC_VERIFICATION_PROVED"
  | "HARMONIC_VERIFICATION_REFUTED"
  | "HARMONIC_VERIFICATION_UNRESOLVED"
  | "HARMONIC_GRADE_PENDING"
  | "HARMONIC_GRADED";

export type ProofStatus =
  | "PENDING"
  | "PROVED"
  | "REFUTED"
  | "UNRESOLVED"
  | "ERROR"
  | "STALE";

export type ProofPropertyResult = {
  id: string;
  description: string;
  status: ProofStatus;
};

export type RegisterAgentInput = {
  name: string;
  kind?: "mcp" | "robinhood" | "factory" | "terminal" | "other";
  url?: string;
};

export type RegisterAgentResult = {
  harmonicRegistryId: string;
  harmonicIdentity: string;
  secret: string;
  externalUrl: string;
  raw: Record<string, unknown>;
};

export type FileExpectationInput = {
  subject: string;
  direction: HarmonicDirection;
  horizon?: HarmonicHorizon;
  note?: string;
  secret: string;
};

export type FileExpectationResult = {
  harmonicReference: string;
  externalUrl: string;
  status: "FILED";
  raw: Record<string, unknown>;
};

export type SealInput = {
  commitment: string;
  horizon?: HarmonicHorizon;
  secret: string;
};

export type SealResult = {
  harmonicReference: string;
  externalUrl: string;
  status: "SEALED";
  raw: Record<string, unknown>;
};

export type RevealInput = {
  id: string;
  subject: string;
  direction: HarmonicDirection;
  salt: string;
  secret: string;
};

export type RevealResult = {
  harmonicReference: string;
  externalUrl: string;
  status: "REVEALED";
  raw: Record<string, unknown>;
};

export type RegistryLookupInput = {
  id: string;
};

export type RegistryRecord = {
  id: string;
  status: string;
  raw: Record<string, unknown>;
};

export type VerificationRequestInput = {
  address: string;
  from?: string;
};

export type VerificationRequestResult = {
  externalReference: string;
  status: ProofStatus;
  raw: Record<string, unknown>;
};

export interface HarmonicAgentClient {
  registerAgent(input: RegisterAgentInput): Promise<RegisterAgentResult>;
  fileExpectation(input: FileExpectationInput): Promise<FileExpectationResult>;
  seal(input: SealInput): Promise<SealResult>;
  reveal(input: RevealInput): Promise<RevealResult>;
  getRegistryRecord(input: RegistryLookupInput): Promise<RegistryRecord>;
  requestVerification?(
    input: VerificationRequestInput,
  ): Promise<VerificationRequestResult>;
}

export type OptraExpectationPayload = {
  agent_id: string;
  decision_id: string;
  underlying: string;
  strategy: string;
  action: string;
  directional_context: string;
  horizon: HarmonicHorizon;
  expected_condition: string;
  recipe_hash: string;
  strategy_mandate_hash: string;
  risk_mandate_hash: string;
  economic_mandate_hash: string;
  runtime_version: string;
  created_at: string;
};

export type VerificationPolicyConfig = {
  harmonicRequiredBeforeExecution: boolean;
  filingMode: HarmonicFilingMode;
  onHarmonicUnavailable: HarmonicUnavailablePolicy;
  requireProofBeforeActivation: boolean;
};

export type OptraGradeRecord = {
  agentId: string;
  decisionId: string;
  expectationId?: string | null;
  harmonicReference?: string | null;
  ruleCompliance: "PASS" | "FAIL" | "UNKNOWN";
  expectationOutcome: "CORRECT" | "INCORRECT" | "INDETERMINATE" | "PENDING";
  executionQuality?: number | null;
  pnl?: string | null;
  evidenceRefs: string[];
  gradedAt: Date;
};

