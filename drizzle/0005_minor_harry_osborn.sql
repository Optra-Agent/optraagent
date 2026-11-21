CREATE TABLE "callput_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_event_id" varchar(36) NOT NULL,
	"reference_kind" varchar(24) NOT NULL,
	"transaction_kind" varchar(32) NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"request_key" varchar(66),
	"payload_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "callput_order_events" ADD CONSTRAINT "callput_order_events_order_id_callput_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."callput_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callput_order_events" ADD CONSTRAINT "callput_order_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "callput_order_events_owner_event_idx" ON "callput_order_events" USING btree ("owner_id","client_event_id");--> statement-breakpoint
CREATE INDEX "callput_order_events_order_created_idx" ON "callput_order_events" USING btree ("order_id","created_at");