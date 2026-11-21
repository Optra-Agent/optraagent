import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { callputOrderEvents, callputOrders } from "../../db/schema";
import type { AppDatabase } from "../db/client";
import { SessionSchema } from "../domain/contracts";
import type { Session } from "../domain/contracts";
import { CALLPUT_ROBINHOOD_CHAIN_ID } from "./callput-robinhood-readonly";
import { CALLPUT_ROBINHOOD_UNDERLYINGS, CALLPUT_SPREAD_STRATEGIES } from "./callput-robinhood-write";

const AddressSchema = z.string().regex(/^0x[\da-fA-F]{40}$/);
const Bytes32Schema = z.string().regex(/^0x[\da-fA-F]{64}$/);
const RawUintSchema = z.string().regex(/^\d{1,78}$/);
const UnderlyingSchema = z.enum(Object.keys(CALLPUT_ROBINHOOD_UNDERLYINGS) as [keyof typeof CALLPUT_ROBINHOOD_UNDERLYINGS, ...(keyof typeof CALLPUT_ROBINHOOD_UNDERLYINGS)[]]);
const CommonIntentSchema = z.object({
  version: z.literal(1),
  chainId: z.literal(CALLPUT_ROBINHOOD_CHAIN_ID),
  account: AddressSchema,
  underlying: UnderlyingSchema,
  underlyingAssetIndex: z.number().int().positive().max(65_535),
  createdAtMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const OpenIntentSchema = CommonIntentSchema.extend({
  kind: z.literal("open"),
  strategy: z.enum(CALLPUT_SPREAD_STRATEGIES),
  longOptionId: Bytes32Schema,
  shortOptionId: Bytes32Schema,
  expiry: z.number().int().positive().max(0xffffffffff),
  sizeRaw: RawUintSchema,
  minSizeRaw: RawUintSchema,
  amountInRaw: RawUintSchema,
}).strict();

const PositionActionIntentSchema = CommonIntentSchema.extend({
  id: z.string().min(1).max(128),
  kind: z.enum(["close", "settle"]),
  optionTokenId: RawUintSchema,
  positionBalanceBeforeRaw: RawUintSchema,
  sizeRaw: RawUintSchema.nullable(),
  minAmountOutRaw: RawUintSchema.nullable(),
  minOutWhenSwapRaw: RawUintSchema,
}).strict().superRefine((intent, ctx) => {
  if (intent.kind === "close" && (!intent.sizeRaw || !intent.minAmountOutRaw)) {
    ctx.addIssue({ code: "custom", message: "Close intents require size and minimum output values.", path: ["sizeRaw"] });
  }
  if (intent.kind === "settle" && (intent.sizeRaw !== null || intent.minAmountOutRaw !== null)) {
    ctx.addIssue({ code: "custom", message: "Settlement intents do not accept client-supplied close sizing fields.", path: ["sizeRaw"] });
  }
});

const IntentSchema = z.discriminatedUnion("kind", [OpenIntentSchema, PositionActionIntentSchema]);
const CreateOrderSchema = z.object({
  clientIntentId: z.uuid(),
  intent: IntentSchema,
}).strict();
const TransactionKindSchema = z.enum(["usdg-approval", "open-spread", "option-token-approval", "close-position", "settle-position"]);
const OrderEventSchema = z.discriminatedUnion("referenceKind", [
  z.object({
    eventId: z.uuid(),
    referenceKind: z.literal("transaction"),
    transactionKind: TransactionKindSchema,
    transactionHash: Bytes32Schema,
  }).strict(),
  z.object({
    eventId: z.uuid(),
    referenceKind: z.literal("request-key"),
    transactionKind: z.enum(["open-spread", "close-position"]),
    transactionHash: Bytes32Schema,
    requestKey: Bytes32Schema,
  }).strict(),
]);

export type CallPutOrderIntentRecord = z.infer<typeof IntentSchema>;

export type CallPutOrderLedgerOptions = {
  db: AppDatabase;
  readSession: (request: Request) => Promise<Session | Response>;
  now?: () => Date;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function error(code: "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_ERROR", message: string, status: number): Response {
  return json({ error: { code, message, retryable: status >= 500 } }, status);
}

function resolveSession(value: Session | Response): { session: Session } | { response: Response } {
  if (value instanceof Response) return { response: value };
  const parsed = SessionSchema.safeParse(value);
  return parsed.success
    ? { session: parsed.data }
    : { response: error("INTERNAL_ERROR", "Unable to validate the current wallet session.", 500) };
}

async function readJson(request: Request): Promise<unknown | Response> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16_384) return error("VALIDATION_ERROR", "CallPut order record exceeds the 16 KiB limit.", 413);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return error("VALIDATION_ERROR", "Request body must be valid JSON.", 400);
  }
}

function hashIntent(intent: CallPutOrderIntentRecord): string {
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}

export function createCallPutOrderHandlers(options: CallPutOrderLedgerOptions) {
  const now = options.now ?? (() => new Date());

  return {
    async list(request: Request): Promise<Response> {
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
      const auth = resolveSession(await options.readSession(request));
      if ("response" in auth) return auth.response;
      const ownerId = z.uuid().safeParse(auth.session.user.id);
      if (!ownerId.success) return error("INTERNAL_ERROR", "The authenticated wallet owner ID is invalid.", 500);

      try {
        const orders = await options.db.select({
          id: callputOrders.id,
          clientIntentId: callputOrders.clientIntentId,
          account: callputOrders.account,
          chainId: callputOrders.chainId,
          kind: callputOrders.kind,
          intent: callputOrders.intent,
          createdAt: callputOrders.createdAt,
          updatedAt: callputOrders.updatedAt,
        }).from(callputOrders)
          .where(eq(callputOrders.ownerId, ownerId.data))
          .orderBy(desc(callputOrders.createdAt))
          .limit(100);
        const events = orders.length === 0 ? [] : await options.db.select({
          id: callputOrderEvents.id,
          orderId: callputOrderEvents.orderId,
          clientEventId: callputOrderEvents.clientEventId,
          referenceKind: callputOrderEvents.referenceKind,
          transactionKind: callputOrderEvents.transactionKind,
          transactionHash: callputOrderEvents.transactionHash,
          requestKey: callputOrderEvents.requestKey,
          createdAt: callputOrderEvents.createdAt,
        }).from(callputOrderEvents)
          .where(and(eq(callputOrderEvents.ownerId, ownerId.data), inArray(callputOrderEvents.orderId, orders.map((order) => order.id))))
          .orderBy(desc(callputOrderEvents.createdAt))
          .limit(500);
        const eventsByOrder = new Map<string, typeof events>();
        for (const event of events) eventsByOrder.set(event.orderId, [...(eventsByOrder.get(event.orderId) ?? []), event]);
        return json({
          orders: orders.map((order) => ({
            ...order,
            events: (eventsByOrder.get(order.id) ?? []).map(({ clientEventId, ...event }) => ({
              ...event,
              eventId: clientEventId,
              verification: "client-reported-reference" as const,
            })),
          })),
        });
      } catch {
        return error("INTERNAL_ERROR", "Unable to load persisted CallPut order intents.", 500);
      }
    },

    async create(request: Request): Promise<Response> {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
      const auth = resolveSession(await options.readSession(request));
      if ("response" in auth) return auth.response;
      const ownerId = z.uuid().safeParse(auth.session.user.id);
      if (!ownerId.success) return error("INTERNAL_ERROR", "The authenticated wallet owner ID is invalid.", 500);

      const raw = await readJson(request);
      if (raw instanceof Response) return raw;
      const parsed = CreateOrderSchema.safeParse(raw);
      if (!parsed.success) return error("VALIDATION_ERROR", "CallPut order intent is invalid or contains unsupported fields.", 400);
      const { clientIntentId, intent } = parsed.data;
      if (intent.account.toLowerCase() !== auth.session.user.address.toLowerCase()) {
        return error("FORBIDDEN", "CallPut order account must match the authenticated wallet.", 403);
      }

      try {
        const createdAt = now();
        const payloadHash = hashIntent(intent);
        const [inserted] = await options.db.insert(callputOrders).values({
          ownerId: ownerId.data,
          clientIntentId,
          account: intent.account.toLowerCase(),
          chainId: CALLPUT_ROBINHOOD_CHAIN_ID,
          kind: intent.kind,
          intent,
          payloadHash,
          createdAt,
          updatedAt: createdAt,
        }).onConflictDoNothing({ target: [callputOrders.ownerId, callputOrders.clientIntentId] }).returning({ id: callputOrders.id });

        const [match] = await options.db.select({
          id: callputOrders.id,
          clientIntentId: callputOrders.clientIntentId,
          account: callputOrders.account,
          chainId: callputOrders.chainId,
          kind: callputOrders.kind,
          intent: callputOrders.intent,
          createdAt: callputOrders.createdAt,
          updatedAt: callputOrders.updatedAt,
          payloadHash: callputOrders.payloadHash,
        }).from(callputOrders)
          .where(and(eq(callputOrders.ownerId, ownerId.data), eq(callputOrders.clientIntentId, clientIntentId)))
          .limit(1);
        if (!match) return error("INTERNAL_ERROR", "Unable to read back the persisted CallPut order intent.", 500);
        if (match.payloadHash !== payloadHash) return error("CONFLICT", "This idempotency key is already bound to a different CallPut order intent.", 409);
        const publicOrder = {
          id: match.id,
          clientIntentId: match.clientIntentId,
          account: match.account,
          chainId: match.chainId,
          kind: match.kind,
          intent: match.intent,
          createdAt: match.createdAt,
          updatedAt: match.updatedAt,
        };
        return json({ order: publicOrder, idempotentReplay: !inserted }, inserted ? 201 : 200);
      } catch {
        return error("INTERNAL_ERROR", "Unable to persist this CallPut order intent.", 500);
      }
    },

    async appendEvent(request: Request, orderIdInput: string): Promise<Response> {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
      const auth = resolveSession(await options.readSession(request));
      if ("response" in auth) return auth.response;
      const ownerId = z.uuid().safeParse(auth.session.user.id);
      const orderId = z.uuid().safeParse(orderIdInput);
      if (!ownerId.success) return error("INTERNAL_ERROR", "The authenticated wallet owner ID is invalid.", 500);
      if (!orderId.success) return error("NOT_FOUND", "CallPut order was not found.", 404);

      const raw = await readJson(request);
      if (raw instanceof Response) return raw;
      const parsed = OrderEventSchema.safeParse(raw);
      if (!parsed.success) return error("VALIDATION_ERROR", "CallPut transaction reference is invalid or contains unsupported fields.", 400);

      try {
        const [order] = await options.db.select({ id: callputOrders.id, kind: callputOrders.kind })
          .from(callputOrders)
          .where(and(eq(callputOrders.id, orderId.data), eq(callputOrders.ownerId, ownerId.data)))
          .limit(1);
        if (!order) return error("NOT_FOUND", "CallPut order was not found.", 404);

        const event = parsed.data;
        const permittedKinds = order.kind === "open"
          ? ["usdg-approval", "open-spread"]
          : order.kind === "close"
            ? ["option-token-approval", "close-position"]
            : ["option-token-approval", "settle-position"];
        if (!permittedKinds.includes(event.transactionKind)) return error("VALIDATION_ERROR", "Transaction kind does not match this CallPut order.", 400);
        if (event.referenceKind === "request-key" && !((order.kind === "open" && event.transactionKind === "open-spread") || (order.kind === "close" && event.transactionKind === "close-position"))) {
          return error("VALIDATION_ERROR", "Request keys are only accepted for matching open or close transactions.", 400);
        }

        const createdAt = now();
        const payloadHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
        const [inserted] = await options.db.insert(callputOrderEvents).values({
          orderId: order.id,
          ownerId: ownerId.data,
          clientEventId: event.eventId,
          referenceKind: event.referenceKind,
          transactionKind: event.transactionKind,
          transactionHash: event.transactionHash.toLowerCase(),
          requestKey: event.referenceKind === "request-key" ? event.requestKey.toLowerCase() : null,
          payloadHash,
          createdAt,
        }).onConflictDoNothing({ target: [callputOrderEvents.ownerId, callputOrderEvents.clientEventId] }).returning({ id: callputOrderEvents.id });

        const [stored] = await options.db.select({
          id: callputOrderEvents.id,
          orderId: callputOrderEvents.orderId,
          clientEventId: callputOrderEvents.clientEventId,
          referenceKind: callputOrderEvents.referenceKind,
          transactionKind: callputOrderEvents.transactionKind,
          transactionHash: callputOrderEvents.transactionHash,
          requestKey: callputOrderEvents.requestKey,
          payloadHash: callputOrderEvents.payloadHash,
          createdAt: callputOrderEvents.createdAt,
        }).from(callputOrderEvents)
          .where(and(eq(callputOrderEvents.ownerId, ownerId.data), eq(callputOrderEvents.clientEventId, event.eventId)))
          .limit(1);
        if (!stored) return error("INTERNAL_ERROR", "Unable to read back the persisted CallPut transaction reference.", 500);
        if (stored.orderId !== order.id || stored.payloadHash !== payloadHash) return error("CONFLICT", "This event id is already bound to a different CallPut reference.", 409);
        return json({
          event: {
            id: stored.id,
            orderId: stored.orderId,
            referenceKind: stored.referenceKind,
            transactionKind: stored.transactionKind,
            transactionHash: stored.transactionHash,
            requestKey: stored.requestKey,
            createdAt: stored.createdAt,
            eventId: stored.clientEventId,
            verification: "client-reported-reference",
          },
          idempotentReplay: !inserted,
        }, inserted ? 201 : 200);
      } catch {
        return error("INTERNAL_ERROR", "Unable to persist this CallPut transaction reference.", 500);
      }
    },
  };
}
