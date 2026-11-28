CREATE TABLE "agent_economic_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"service_balance_atomic" varchar(78) DEFAULT '0' NOT NULL,
	"total_funded_atomic" varchar(78) DEFAULT '0' NOT NULL,
	"total_spent_atomic" varchar(78) DEFAULT '0' NOT NULL,
	"spent_today_atomic" varchar(78) DEFAULT '0' NOT NULL,
	"spend_day_utc" varchar(10) NOT NULL,
	"requests_this_hour" integer DEFAULT 0 NOT NULL,
	"hour_window_start" varchar(32) NOT NULL,
	"mandate" jsonb NOT NULL,
	"mandate_hash" varchar(71) NOT NULL,
	"mandate_version" integer DEFAULT 1 NOT NULL,
	"machine_spending_status" varchar(16) DEFAULT 'PAUSED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_economic_accounts_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "agent_economic_budget_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"amount_atomic" varchar(78) DEFAULT '0' NOT NULL,
	"balance_after_atomic" varchar(78) NOT NULL,
	"mandate_hash" varchar(71) NOT NULL,
	"actor" varchar(64) NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economic_global_controls" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"pause_all_autonomous_agents" boolean DEFAULT false NOT NULL,
	"pause_new_entries" boolean DEFAULT false NOT NULL,
	"pause_machine_service_spending" boolean DEFAULT false NOT NULL,
	"disable_x402_globally" boolean DEFAULT false NOT NULL,
	"emergency_deny_all_machine_payments" boolean DEFAULT false NOT NULL,
	"disabled_providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disabled_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_providers" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"endpoint" text NOT NULL,
	"service_category" varchar(32) NOT NULL,
	"payment_protocol" varchar(16) DEFAULT 'X402' NOT NULL,
	"accepted_assets" jsonb NOT NULL,
	"network" varchar(32) NOT NULL,
	"pay_to" varchar(42) NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"trust_tier" varchar(24) DEFAULT 'OPTRA_VERIFIED' NOT NULL,
	"ownership" varchar(24) DEFAULT 'OPTRA_OWNED' NOT NULL,
	"expected_response_schema" varchar(64),
	"max_known_price_atomic" varchar(78),
	"health_check_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x402_payment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" varchar(256) NOT NULL,
	"agent_id" uuid NOT NULL,
	"provider_id" varchar(64) NOT NULL,
	"service_category" varchar(32) NOT NULL,
	"request_nonce" varchar(128) NOT NULL,
	"request_hash" varchar(71) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"amount_atomic" varchar(78) NOT NULL,
	"asset" varchar(64) NOT NULL,
	"network" varchar(32) NOT NULL,
	"payment_mode" varchar(16) DEFAULT 'EXACT' NOT NULL,
	"settlement_mode" varchar(24) DEFAULT 'PAPER_REHEARSAL' NOT NULL,
	"status" varchar(24) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"payment_challenge" jsonb,
	"payment_reference" varchar(128),
	"settlement_reference" varchar(128),
	"tx_hash" varchar(66),
	"response_hash" varchar(71),
	"validation_status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"validation_reason" text,
	"economic_mandate_hash" varchar(71) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x402_tape_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" varchar(256) NOT NULL,
	"agent_id" uuid NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"provider_id" varchar(64),
	"service_category" varchar(32),
	"amount_atomic" varchar(78),
	"asset" varchar(64),
	"request_hash" varchar(71),
	"response_hash" varchar(71),
	"payment_reference" varchar(128),
	"tx_hash" varchar(66),
	"economic_mandate_hash" varchar(71) NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_economic_accounts" ADD CONSTRAINT "agent_economic_accounts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_economic_accounts" ADD CONSTRAINT "agent_economic_accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_economic_budget_events" ADD CONSTRAINT "agent_economic_budget_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_economic_budget_events" ADD CONSTRAINT "agent_economic_budget_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payment_records" ADD CONSTRAINT "x402_payment_records_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_tape_events" ADD CONSTRAINT "x402_tape_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_economic_accounts_owner_idx" ON "agent_economic_accounts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agent_economic_budget_events_agent_idx" ON "agent_economic_budget_events" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "x402_payment_records_agent_idemp_idx" ON "x402_payment_records" USING btree ("agent_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "x402_payment_records_agent_nonce_idx" ON "x402_payment_records" USING btree ("agent_id","request_nonce");--> statement-breakpoint
CREATE INDEX "x402_payment_records_agent_created_idx" ON "x402_payment_records" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "x402_payment_records_decision_idx" ON "x402_payment_records" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "x402_tape_events_agent_created_idx" ON "x402_tape_events" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "x402_tape_events_decision_idx" ON "x402_tape_events" USING btree ("decision_id");