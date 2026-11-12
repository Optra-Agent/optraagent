# Agent Intelligence Graph Data Contract

Updated: 2026-11-12

## Purpose and scope

This contract supports a public, read-only graph of Optra product capabilities. It describes four House Agent templates, the six PM hook stages, hook availability/details, the supported Protective Put composition, and optional illustrative decision storytelling.

The graph is a frontend adapter over existing public APIs and one shared recipe-membership constant. **No new endpoint or source change is needed.** Public Tape currently contains no records. The marketing graph must not fetch, copy, or infer user-specific records from authenticated APIs.

Graph edges encode template/recipe membership, stage grouping, optional conceptual stage ordering, lifecycle capability, or a rule-evaluation reference. Do not create agent-to-agent edges or imply that House Agents communicate with one another.

## Available data sources

| Source | Visibility | Available data | Graph use |
|---|---|---|---|
| `GET /api/public/v1/templates` | Public, read-only | `HouseAgentTemplateCatalogResponse`: `id`, `name`, `availability`, `reason`. | Four template overview nodes and availability badges. |
| `GET /api/public/v1/hooks` | Public, read-only | `HookCatalogResponse`: coverage counts by stage plus all 36 `HookDefinition` rows. | Six stage nodes; hook nodes; detail panels; implementation status. |
| `PAPER_PROTECTIVE_PUT_HOOK_IDS` from `lib/hooks/catalog.ts` | Shared static registry data | Canonical hook membership for the one supported Protective Put recipe. | Edges from the Protective Put recipe node to its 15 supported hooks. Import this constant; do not copy the list. |
| `GET /api/public/v1/verify` | Public, read-only | Public capability claims, including evaluator/template counts, modeled pricing limits, `v4ClaimLevel: "L0"`, and `liveTradingEnabled: false`. | Optional product-safety/provenance badge. This is not activity data. |
| `GET /api/public/v1/agents` | Public, read-only | Always `{ agents: [] }`; no public-visibility model exists. | Confirms there are no public user-agent nodes. |
| `GET /api/public/v1/tape` | Public, read-only | Currently `{ decisions: [], orders: [], executionMode: "PAPER" }`. | Confirms no public decision trace is available. Keep actual public trace references empty. |
| `POST /api/recipes/validate` | Public, read-only validation | Validates a submitted `RecipeV1`; returns validity/hash/issues, not the canonical supported recipe. | Optional validation of a frontend-created recipe object. It does not supply graph membership. |
| `GET /api/agents` and `GET /api/agents/{agentId}` | Authenticated, owner-scoped | User-created agent records and recipe details. `Agent` includes `ownerId` and lifecycle status. | Do not call from the public landing graph. |
| `GET /api/agents/{agentId}/tape` | Authenticated, owner-scoped | `TapeResponse`: that owner’s decisions and paper orders. | Not a public graph source. |
| `GET /api/agents/{agentId}/positions` | Authenticated, owner-scoped | That owner’s modeled positions. | Not a public graph source. |

`/api/public/v1/hooks` and `/api/public/v1/templates` are public wrappers over the same registry data as `/api/hooks` and `/api/agents/templates`. Prefer the versioned public paths from the landing page.

The workspace also contains a landing adapter in `components/marketing/graph-data.ts`. It reads the same hook/template/recipe registries directly and does not add a backend endpoint. Reuse that registry-backed adapter where server rendering is appropriate, or use the public routes above for browser fetching. Do not maintain a second copy of hook or template metadata.

## Current capability facts

- Templates: `covered_call`, `cash_secured_put`, `protective_put`, and `earnings_straddle`.
- Only `protective_put` is `paper_ready`; the other three are `preview` and each includes a reason.
- Hook stages, in PM taxonomy order: `gate`, `strike`, `size`, `pulse`, `expiry`, `breaker`.
- Expected hook counts by stage: `10`, `7`, `4`, `7`, `3`, `5` respectively; 36 definitions are registered.
- Hook availability is separate from evaluation outcome: 15 hooks are `implemented`; 21 are `catalog_only`.
- The supported Protective Put uses these 15 hook IDs: `calmo`, `corpax`, `sessia`, `percy`, `tenora`, `coverix`, `capra`, `trailo`, `lastra`, `nextra`, `haltr`, `daylo`, `drawra`, `exposa`, `venux`.
- Its mandatory breakers are `haltr`, `daylo`, `drawra`, `exposa`, and `venux`.
- Protective Put option premiums and paper fills are modeled with Black–Scholes; they are not venue quotes or real orders. Live trading is disabled.
- Historical underlying candles are real where source coverage verifies; that market-history fact does not imply a public agent decision or live graph activity.

The stage taxonomy is an accurate grouping. A left-to-right stage arrangement may be used as a **conceptual product flow**, but it must not claim that every hook is evaluated in that literal order. Per-tick evaluation order and outcomes belong to the private `AgentDecision.hookResults` array.

## Shared domain types

Canonical Zod schemas and inferred types are in `lib/domain/contracts.ts`:

- `HouseAgentTemplate`, `HouseAgentTemplateCatalogResponse`
- `HookStage`, `HookDefinition`, `HookCatalogResponse`
- `RecipeV1`, `RecipeValidationResult`
- `Agent`, `AgentDetail`, `AgentDecision`
- `HookResult`, `TapeResponse`, `PublicTapeResponse`
- `PaperOrder`, `PaperPosition`, `PublicVerification`

Relevant distinctions:

- Template availability: `paper_ready | preview`.
- Hook implementation availability: `implemented | catalog_only`.
- Hook evaluation status (`HookResult.status`): `pass | block | select | size | action | noop | error | fail | skip`. `fail` and `skip` remain accepted for compatibility.
- Decision action (`AgentDecision.action`): `open | hold | close | skip`.
- Agent lifecycle (`Agent.status`): `draft | running | paused | stopped`.

`HookDefinition.parameters` is typed as `Record<string, unknown>`, not a strict reusable parameter-schema interface. Each current catalog entry supplies descriptor-shaped data, but graph code should treat it as opaque display metadata or explicitly narrow/validate fields before rendering controls. Do not infer an evaluator from a parameter descriptor.

## Suggested frontend graph types

The following is an adapter contract for the landing page, not a new server response. It reuses existing API/domain types and distinguishes data source from graph relationship:

```ts
import type {
  Agent,
  HookDefinition,
  HookResult,
  HookStage,
  HouseAgentTemplate,
} from "@/lib/domain/contracts";

export type GraphHookAvailability = HookDefinition["availability"];
export type GraphHookEvaluationStatus = HookResult["status"];
export type GraphStageId = `stage:${HookStage}`;

export type GraphNode =
  | {
      id: `template:${HouseAgentTemplate["id"]}`;
      kind: "template";
      template: HouseAgentTemplate;
      source: "public_templates_api";
    }
  | {
      id: "recipe:protective_put";
      kind: "recipe";
      templateId: "protective_put";
      hookIds: readonly string[];
      source: "shared_recipe_registry";
      premiumSource: "modeled";
      executionMode: "PAPER";
    }
  | {
      id: GraphStageId;
      kind: "stage";
      stage: HookStage;
      expectedHookCount: number;
      source: "public_hooks_api";
    }
  | {
      id: `hook:${string}`;
      kind: "hook";
      hook: HookDefinition;
      source: "public_hooks_api";
    }
  | {
      id: `lifecycle:${Agent["status"]}`;
      kind: "lifecycle_state";
      status: Agent["status"];
      representation: "capability_state_machine";
      actualAgentId?: never;
    }
  | {
      id: `decision:${string}`;
      kind: "decision_example";
      label: "Illustrative only";
      actualActivity: false;
      source: "illustrative";
    };

export type GraphEdgeKind =
  | "stage_contains_hook"
  | "template_uses_recipe"
  | "recipe_uses_hook"
  | "conceptual_stage_order"
  | "lifecycle_transition"
  | "illustrative_trace_step";

export interface GraphEdge {
  id: string;
  from: GraphNode["id"];
  to: GraphNode["id"];
  kind: GraphEdgeKind;
  source: "public_api" | "shared_recipe_registry" | "capability_model" | "illustrative";
  label?: string;
}

export type GraphDecisionReference =
  | {
      kind: "none";
      source: "/api/public/v1/tape";
      records: readonly [];
    }
  | {
      kind: "illustrative";
      source: "illustrative";
      actualActivity: false;
      label: "Illustrative only";
      steps: Array<{ hookId: string; label: string; illustrative: true }>;
    };

export interface AgentIntelligenceGraphData {
  visibility: "public_capability";
  nodes: GraphNode[];
  edges: GraphEdge[];
  decisionTrace: GraphDecisionReference;
}
```

For stage grouping, use a fixed presentation order derived from the PM stage taxonomy:

```ts
export const AGENT_GRAPH_STAGE_ORDER = [
  "gate", "strike", "size", "pulse", "expiry", "breaker",
] as const satisfies readonly HookStage[];
```

`conceptual_stage_order` and lifecycle edges are capability-diagram relationships. They are not timestamped events. There is deliberately no `agent_to_agent` edge kind.

## Supported Protective Put topology

Build the public capability graph from these relationships:

1. Add four `template` nodes from `/api/public/v1/templates`; preserve each returned `availability` and `reason`.
2. Add one `recipe:protective_put` node because Protective Put is the only `paper_ready` template.
3. Populate its `hookIds` using `PAPER_PROTECTIVE_PUT_HOOK_IDS` from `lib/hooks/catalog.ts`. The constant has the exact same IDs used by `buildProtectivePutRecipe` and the validator.
4. Add six `stage` nodes from `HookCatalogResponse.coverage.expectedByStage` and the `HookStage` union.
5. Add one `hook` node for every returned definition. Preserve `availability`, `summary`, `implementationNote`, `unavailableReason`, and parameter metadata. Add `stage_contains_hook` edges from its stage.
6. Add `template_uses_recipe` from Protective Put to the supported recipe, then `recipe_uses_hook` edges only for the 15 canonical recipe hook IDs.
7. Keep the other three Preview templates unconnected to recipe/hook nodes because their recipe definitions are not exposed or paper-ready.

The 15 recipe members group under the six stages as follows:

| Stage | Protective Put hooks | Count |
|---|---|---:|
| Gate | Calmo, Corpax, Sessia | 3 |
| Strike | Percy, Tenora | 2 |
| Size | Coverix, Capra | 2 |
| Pulse | Trailo | 1 |
| Expiry | Lastra, Nextra | 2 |
| Breaker | Haltr, Daylo, Drawra, Exposa, Venux | 5 |

Other registered hook nodes remain visible as catalog capability. They should not receive `recipe_uses_hook` edges for Protective Put.

## Lifecycle states and transitions

`Agent.status` defines `draft`, `running`, `paused`, and `stopped`. Authenticated lifecycle actions are implemented as follows:

- `draft → running`: launch after a complete matching backtest.
- `running → paused`: pause.
- `paused → running`: resume only with the still-valid attached backtest proof.
- Any non-stopped state may transition to `stopped`.

There is no public endpoint returning actual agents or their current states. A public graph may show these as `capability_state_machine` nodes and `lifecycle_transition` edges, with labeling that identifies them as the product lifecycle model. Do not populate them from owner-scoped `/api/agents` records or suggest that an actual agent is currently running.

## Rule evaluations and decision references

An authenticated owner’s `GET /api/agents/{agentId}/tape` returns a private `TapeResponse`:

- Each `AgentDecision` has `id`, `agentId`, `tickId`, `action`, `reason`, `hookResults`, optional `marketContext`, `snapshotSource`, `recipeHash`, and `createdAt`.
- Each `HookResult` has `hookId`, evaluation `status`, `reason`, and optional value/threshold/unit/data references.
- `GET /api/agents/{agentId}/positions` exposes that owner’s modeled positions; do not project those into public graph data.

The anonymous `/api/public/v1/tape` currently returns empty decisions and orders. Therefore the landing page has **no actual public decision traces** to display. Keep `decisionTrace` as `{ kind: "none", source: "/api/public/v1/tape", records: [] }` when the public response is empty.

If the visual needs a sample path, use a separate `kind: "illustrative"` item and visibly label it **Illustrative only**. Its steps may reference real hook IDs/names and describe the configured rule concept. Do not add a user/agent ID, decision ID, timestamp, market value, premium, fill, performance number, position, or a pass/block result that could be mistaken for an observed Tape event. No illustration may be serialized as `AgentDecision` or `HookResult`.

### Existing landing-adapter caution

The current `components/marketing/graph-data.ts` adapter creates `EXAMPLE_TEXT` entries with sample value strings and statuses, plus `illustrativeScenarios()` with synthetic pass/block verdicts and `open`/`skip` actions. `components/marketing/graph-flow.ts` marks those scenarios with `source: "illustrative"`, but that source marker is data only; the rendered graph must make the label visible for the whole scenario and any displayed sample values. These are not API responses, engine-run outputs, or Tape events. Keep them isolated from actual records, or omit the sample outcomes/values. `scenarioFromDecision()` should only receive records returned by the public Tape endpoint; that endpoint currently returns no decisions. It also normalizes some hook statuses for presentation (`fail`/`error` to `block`, `skip` to `noop`), so retain canonical `HookResult.status` in any adapter that presents actual records.

## Public/private boundary

- Public graph fetches only `/api/public/v1/templates`, `/api/public/v1/hooks`, `/api/public/v1/verify`, and `/api/public/v1/tape`.
- `/api/public/v1/agents` and `/api/public/v1/tape` intentionally return empty arrays. The handlers do not query owner records.
- `/api/agents`, `/api/agents/{id}`, `/api/agents/{id}/tape`, and `/api/agents/{id}/positions` require a valid session and verify owner scope. Missing/cross-owner agent reads return 404.
- `Agent` includes `ownerId`; `AgentDetail` contains the user’s recipe; `AgentDecision` may contain private market context; `PaperPosition` contains position quantities/prices. Treat all of these as private even if a client already holds a session.
- Do not pass wallet/session/owner identifiers, recipe hashes, private decision rows, or position data into the landing graph. Do not use authenticated cookies to populate its public capability state.

## What is illustrative vs. actual

| Graph content | Classification | Required treatment |
|---|---|---|
| Template names, availability, reasons | Actual public capability data | Use returned template API fields. |
| Hook IDs, names, stages, availability, details | Actual public catalog data | Use returned hook API fields. `implemented` means evaluator exists; it does not mean an evaluation recently passed. |
| Protective Put recipe membership | Actual shared recipe configuration | Use `PAPER_PROTECTIVE_PUT_HOOK_IDS`; it is not a user instance or current activity. |
| Six-stage ordering/layout | Presentation model of PM taxonomy | Label as stage grouping or conceptual flow; do not claim literal evaluation chronology. |
| Agent lifecycle state machine | Actual supported transitions, no public instance state | Label as lifecycle capability/model; do not show nodes as active user agents. |
| Public Tape decisions | No actual records available | Keep empty state, or use the isolated illustrative shape below. |
| Sample decision/evaluation animation | Illustrative only | Prominent `Illustrative only` label; no fabricated outcomes or values. |
| Existing `EXAMPLE_TEXT` and `illustrativeScenarios()` in `components/marketing/graph-data.ts` | Frontend-authored illustration | Never represent the sample values, verdicts, or actions as engine-run evaluations or Tape records. If retained, keep a persistent visible illustration label and separate source/type from public Tape data. |
| Historical candles/options activity | Not graph activity data | Underlying candle history is real only where coverage verifies; premiums are modeled. Never animate a candle or model value as a live/public trade. |
| Agent-to-agent communication | Not a product relationship in this contract | Do not create or label such edges. |

## Missing information

- The public template payload does not include hook membership or a full `RecipeV1`; the exported Protective Put hook-ID constant supplies membership without adding an endpoint.
- No public Tape/decision-trace records exist. Real `HookResult` evaluations are private to an owner’s Tape. A public actual trace would require a separately approved visibility/data product; it is outside this integration pass.
- No public tick-evaluation API exists. The public hook catalog reports evaluator availability and descriptions; `POST /api/recipes/validate` checks recipe validity, not runtime outcomes. Do not manufacture a deterministic evaluation result from those metadata endpoints.
- Preview templates expose their names and blocker reasons, not full recipe compositions. Do not draw inferred hook or option-leg memberships for them.
- Hook parameter descriptors are `unknown` values at the shared TypeScript boundary. They can be shown as opaque details; richer interactive controls would need a distinct typed parameter contract.
- Agent lifecycle status is available only on private `Agent` records. The public graph can show the implemented state machine, not real lifecycle counts/current statuses.

## Claude Code integration guidance

1. Fetch templates and hooks from `/api/public/v1/templates` and `/api/public/v1/hooks`; validate them with `HouseAgentTemplateCatalogResponseSchema` and `HookCatalogResponseSchema` from `lib/domain/contracts.ts`.
2. Build a small frontend adapter that maps the API data into the `AgentIntelligenceGraphData` contract above. Use API definitions as the only source for hook names, descriptions, stages, status, and template availability.
3. Import `PAPER_PROTECTIVE_PUT_HOOK_IDS` for the supported recipe edges. Do not hardcode the 15 IDs in the graph component or infer recipe membership from matching hook names.
4. Use the public Tape response as an empty state. The existing landing adapter contains sample values and pass/block/open/skip scenario content; those are frontend-authored illustrations, not public evaluator results. If retained, label the entire scenario and every sample value **Illustrative only** and keep its type/data path separate from Tape records. Do not use it to populate the actual decision trace.
5. Use `Agent.status` and lifecycle handlers only to explain the lifecycle capability. Never fetch owner-specific agent/Tape/position routes from the public landing.
6. Treat stage order as layout/storytelling. Hook evaluation outcomes come from a private Tape’s `hookResults` array and are unavailable to an anonymous landing page.
7. Keep edges limited to stage membership, template/recipe membership, capability transitions, and explicitly illustrative rule references. Do not imply agent-to-agent communication.
8. No backend route, schema, database, auth, engine, or API change is required for this graph data contract.

Source files: `lib/domain/contracts.ts`, `lib/hooks/catalog.ts`, `lib/hooks/handlers.ts`, `lib/hooks/recipe-validator.ts`, `lib/public/handlers.ts`, `lib/paper/handlers.ts`, the corresponding routes under `app/api/public/v1/`, `app/api/hooks/`, `app/api/agents/templates/`, and `app/api/agents/[agentId]/`, plus the existing landing adapter `components/marketing/graph-data.ts` and illustrative flow helper `components/marketing/graph-flow.ts`.
