CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"template_id" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"recipe" jsonb NOT NULL,
	"recipe_hash" varchar(71) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"source" varchar(64) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"underlying_bid_usd" varchar(64) NOT NULL,
	"underlying_ask_usd" varchar(64) NOT NULL,
	"current_multiplier" varchar(64) NOT NULL,
	"token_bid_usd" varchar(64) NOT NULL,
	"token_ask_usd" varchar(64) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"stale" boolean NOT NULL,
	"trading_halt" boolean NOT NULL,
	"pricing_method" varchar(16) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_decisions" (
	"id" varchar(256) PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"tick_id" varchar(128) NOT NULL,
	"action" varchar(16) NOT NULL,
	"reason" text NOT NULL,
	"hook_results" jsonb NOT NULL,
	"snapshot_id" uuid,
	"snapshot_source" varchar(64) NOT NULL,
	"recipe_hash" varchar(71) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"decision_id" varchar(256) NOT NULL,
	"tick_id" varchar(128) NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"side" varchar(8) NOT NULL,
	"quantity" varchar(64) NOT NULL,
	"price_usd" varchar(64) NOT NULL,
	"fee_usd" varchar(64) NOT NULL,
	"slippage_bps" integer NOT NULL,
	"status" varchar(16) NOT NULL,
	"execution_mode" varchar(8) DEFAULT 'PAPER' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "paper_orders_decision_id_unique" UNIQUE("decision_id")
);
--> statement-breakpoint
CREATE TABLE "paper_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"quantity" varchar(64) NOT NULL,
	"average_entry_usd" varchar(64) NOT NULL,
	"mark_price_usd" varchar(64) NOT NULL,
	"unrealized_pnl_usd" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_decisions" ADD CONSTRAINT "paper_decisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_decisions" ADD CONSTRAINT "paper_decisions_snapshot_id_market_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."market_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_decision_id_paper_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."paper_decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_owner_status_created_idx" ON "agents" USING btree ("owner_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_snapshots_symbol_observed_idx" ON "market_snapshots" USING btree ("symbol","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_decisions_agent_tick_idx" ON "paper_decisions" USING btree ("agent_id","tick_id");--> statement-breakpoint
CREATE INDEX "paper_decisions_agent_created_idx" ON "paper_decisions" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "paper_positions_agent_status_idx" ON "paper_positions" USING btree ("agent_id","status");