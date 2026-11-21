CREATE TABLE "callput_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_intent_id" varchar(128) NOT NULL,
	"account" varchar(42) NOT NULL,
	"chain_id" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"intent" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "callput_orders" ADD CONSTRAINT "callput_orders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "callput_orders_owner_intent_idx" ON "callput_orders" USING btree ("owner_id","client_intent_id");--> statement-breakpoint
CREATE INDEX "callput_orders_owner_created_idx" ON "callput_orders" USING btree ("owner_id","created_at");