CREATE TABLE "live_agent_controls" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"stopped" boolean DEFAULT true NOT NULL,
	"stop_reason" varchar(200),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_agent_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_id" varchar(64) NOT NULL,
	"trading_address" varchar(42) NOT NULL,
	"route" varchar(24) NOT NULL,
	"policy" jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'proposed' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_agent_leases" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"holder" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_agent_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"idempotency_key" varchar(64) NOT NULL,
	"state" varchar(16) DEFAULT 'reserved' NOT NULL,
	"collateral_raw" varchar(78) NOT NULL,
	"transaction_hash" varchar(66),
	"request_key" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_agent_controls" ADD CONSTRAINT "live_agent_controls_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_agent_grants" ADD CONSTRAINT "live_agent_grants_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_agent_leases" ADD CONSTRAINT "live_agent_leases_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_agent_requests" ADD CONSTRAINT "live_agent_requests_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_agent_requests" ADD CONSTRAINT "live_agent_requests_grant_id_live_agent_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."live_agent_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_agent_grants_owner_status_idx" ON "live_agent_grants" USING btree ("owner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "live_agent_grants_one_active_idx" ON "live_agent_grants" USING btree ("owner_id","agent_id") WHERE "live_agent_grants"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "live_agent_requests_owner_key_idx" ON "live_agent_requests" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "live_agent_requests_owner_state_idx" ON "live_agent_requests" USING btree ("owner_id","state");