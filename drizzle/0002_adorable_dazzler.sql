CREATE TABLE "backtest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"recipe" jsonb NOT NULL,
	"recipe_hash" varchar(71) NOT NULL,
	"data_source" varchar(64) NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"sample_count" integer NOT NULL,
	"hourly_coverage_complete" boolean NOT NULL,
	"premium_source" varchar(16) NOT NULL,
	"pricing_method" varchar(16) NOT NULL,
	"status" varchar(24) NOT NULL,
	"metrics" jsonb,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hourly_market_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"hour_bucket" timestamp with time zone NOT NULL,
	"snapshot_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "backtest_run_id" uuid;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hourly_market_samples" ADD CONSTRAINT "hourly_market_samples_snapshot_id_market_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."market_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtest_runs_owner_created_idx" ON "backtest_runs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hourly_market_samples_symbol_hour_idx" ON "hourly_market_samples" USING btree ("symbol","hour_bucket");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_backtest_run_id_backtest_runs_id_fk" FOREIGN KEY ("backtest_run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE restrict ON UPDATE no action;