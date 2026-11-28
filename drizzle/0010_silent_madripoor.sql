CREATE TABLE "harmonic_agent_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"optra_agent_id" uuid NOT NULL,
	"harmonic_registry_id" varchar(128),
	"harmonic_identity" varchar(128),
	"registration_status" varchar(24) DEFAULT 'UNREGISTERED' NOT NULL,
	"encrypted_secret" text,
	"secret_fingerprint" varchar(64),
	"registered_at" timestamp with time zone,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harmonic_expectations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"decision_id" varchar(256) NOT NULL,
	"filing_mode" varchar(24) NOT NULL,
	"status" varchar(24) NOT NULL,
	"underlying" varchar(16) NOT NULL,
	"strategy" varchar(64) NOT NULL,
	"action" varchar(32) NOT NULL,
	"direction" varchar(16) NOT NULL,
	"horizon" varchar(16) NOT NULL,
	"expected_condition" text NOT NULL,
	"recipe_hash" varchar(71) NOT NULL,
	"strategy_mandate_hash" varchar(71) NOT NULL,
	"risk_mandate_hash" varchar(71) NOT NULL,
	"economic_mandate_hash" varchar(71) NOT NULL,
	"runtime_version" varchar(64) NOT NULL,
	"harmonic_reference" varchar(128),
	"commitment_hash" varchar(64),
	"encrypted_salt" text,
	"external_url" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revealed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "harmonic_tape_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" varchar(256) NOT NULL,
	"agent_id" uuid NOT NULL,
	"event_type" varchar(48) NOT NULL,
	"recipe_hash" varchar(71),
	"strategy_mandate_hash" varchar(71),
	"risk_mandate_hash" varchar(71),
	"economic_mandate_hash" varchar(71),
	"kernel_hash" varchar(71),
	"harmonic_reference" varchar(128),
	"status" varchar(32) NOT NULL,
	"external_url" text,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optra_grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"decision_id" varchar(256) NOT NULL,
	"expectation_id" uuid,
	"harmonic_reference" varchar(128),
	"rule_compliance" varchar(24) DEFAULT 'UNKNOWN' NOT NULL,
	"expectation_outcome" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"execution_quality" integer,
	"pnl" varchar(64),
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"graded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optra_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"proof_provider" varchar(32) DEFAULT 'HARMONIC_AGENT' NOT NULL,
	"verifier" varchar(32) DEFAULT 'ARISTOTLE' NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"kernel_name" varchar(64) NOT NULL,
	"kernel_hash" varchar(71) NOT NULL,
	"recipe_hash" varchar(71) NOT NULL,
	"strategy_mandate_hash" varchar(71) NOT NULL,
	"risk_mandate_hash" varchar(71) NOT NULL,
	"economic_mandate_hash" varchar(71) NOT NULL,
	"code_version" varchar(64) NOT NULL,
	"properties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_reference" varchar(128),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"harmonic_required_before_execution" boolean DEFAULT false NOT NULL,
	"filing_mode" varchar(24) DEFAULT 'PUBLIC_OPEN' NOT NULL,
	"on_harmonic_unavailable" varchar(32) DEFAULT 'ALLOW_WITH_UNVERIFIED_LABEL' NOT NULL,
	"require_proof_before_activation" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "harmonic_agent_bindings" ADD CONSTRAINT "harmonic_agent_bindings_optra_agent_id_agents_id_fk" FOREIGN KEY ("optra_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harmonic_expectations" ADD CONSTRAINT "harmonic_expectations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harmonic_tape_events" ADD CONSTRAINT "harmonic_tape_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optra_grades" ADD CONSTRAINT "optra_grades_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optra_grades" ADD CONSTRAINT "optra_grades_expectation_id_harmonic_expectations_id_fk" FOREIGN KEY ("expectation_id") REFERENCES "public"."harmonic_expectations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optra_proofs" ADD CONSTRAINT "optra_proofs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_policies" ADD CONSTRAINT "verification_policies_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "harmonic_agent_bindings_optra_agent_idx" ON "harmonic_agent_bindings" USING btree ("optra_agent_id");--> statement-breakpoint
CREATE INDEX "harmonic_expectations_agent_created_idx" ON "harmonic_expectations" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "harmonic_expectations_agent_decision_idx" ON "harmonic_expectations" USING btree ("agent_id","decision_id");--> statement-breakpoint
CREATE INDEX "harmonic_tape_events_agent_created_idx" ON "harmonic_tape_events" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "harmonic_tape_events_decision_idx" ON "harmonic_tape_events" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "optra_grades_agent_graded_idx" ON "optra_grades" USING btree ("agent_id","graded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "optra_grades_agent_decision_idx" ON "optra_grades" USING btree ("agent_id","decision_id");--> statement-breakpoint
CREATE INDEX "optra_proofs_agent_requested_idx" ON "optra_proofs" USING btree ("agent_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_policies_agent_idx" ON "verification_policies" USING btree ("agent_id");