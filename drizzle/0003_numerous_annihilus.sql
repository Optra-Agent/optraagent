CREATE TABLE "paper_accounts" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"initial_capital_usd" varchar(64) NOT NULL,
	"cash_usd" varchar(64) NOT NULL,
	"realized_pnl_usd" varchar(64) DEFAULT '0' NOT NULL,
	"peak_equity_usd" varchar(64) NOT NULL,
	"daily_start_equity_usd" varchar(64) NOT NULL,
	"daily_start_date" varchar(10) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_orders" DROP CONSTRAINT "paper_orders_decision_id_unique";--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD COLUMN "entry_order_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD COLUMN "exit_order_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD COLUMN "history_data_hash" varchar(71);--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD COLUMN "history_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD COLUMN "history_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD COLUMN "pricing_assumptions" jsonb;--> statement-breakpoint
ALTER TABLE "paper_decisions" ADD COLUMN "market_context" jsonb;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "order_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "position_id" uuid;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "instrument_type" varchar(32) DEFAULT 'modeled_option' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "option_type" varchar(8) DEFAULT 'put' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "strike_usd" varchar(64) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "expiry_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "implied_volatility" varchar(64) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "model_premium_usd" varchar(64) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "model_name" varchar(64) DEFAULT 'black_scholes_european_put' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "premium_source" varchar(16) DEFAULT 'modeled' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "model_inputs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "instrument_type" varchar(32) DEFAULT 'modeled_option' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "option_type" varchar(8) DEFAULT 'put' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "strike_usd" varchar(64) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "expiry_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "implied_volatility" varchar(64) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "model_name" varchar(64) DEFAULT 'black_scholes_european_put' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "premium_source" varchar(16) DEFAULT 'modeled' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "model_inputs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "peak_mark_price_usd" varchar(64) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "opened_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "realized_pnl_usd" varchar(64) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_orders_agent_tick_seq_idx" ON "paper_orders" USING btree ("agent_id","tick_id","order_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_positions_agent_open_idx" ON "paper_positions" USING btree ("agent_id") WHERE "paper_positions"."status" = 'open';