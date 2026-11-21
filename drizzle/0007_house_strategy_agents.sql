DROP INDEX "paper_positions_agent_open_idx";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "kind" varchar(16) DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "visibility" varchar(16) DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "house_key" varchar(48);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "launched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "purpose" varchar(32);--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "leg_role" varchar(16);--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "side" varchar(8) DEFAULT 'long' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "collateral_usd" varchar(64) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "structure_id" varchar(160);--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "leg_role" varchar(16);--> statement-breakpoint
CREATE INDEX "agents_visibility_status_idx" ON "agents" USING btree ("visibility","status");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_house_recipe_idx" ON "agents" USING btree ("house_key","recipe_hash") WHERE "agents"."kind" = 'house';--> statement-breakpoint
CREATE UNIQUE INDEX "paper_positions_agent_open_idx" ON "paper_positions" USING btree ("agent_id") WHERE "paper_positions"."status" = 'open' and "paper_positions"."side" = 'long' and "paper_positions"."structure_id" is null;