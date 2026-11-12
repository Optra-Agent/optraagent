# Agent Intelligence Graph Data Contract

Updated: 2026-11-12

## Purpose and scope

This contract supports a public, read-only graph that expands one selected House Agent template into its rule system: **Selected Agent → Hook Stages → Hook Evaluations → Risk Guard → Paper Decision → Optra Tape**. The root is the `protective_put` template, not a running user's agent instance. It also describes all four House Agent templates, all six PM hook stages, hook availability/details, the supported Protective Put composition, and the provenance of any evaluation storytelling.

The graph is a frontend adapter over existing public APIs and one shared recipe-membership constant. **No new endpoint or source change is needed.** Public Tape currently contains no records and no public tick-evaluation endpoint exists. The marketing graph must not fetch, copy, or infer user-specific records from authenticated APIs.

Graph edges encode template/recipe membership, stage grouping, evaluator capability, Breaker guard membership, conceptual transitions to paper decision and Tape, lifecycle capability, or explicitly sourced evaluation references. The six stages are rule groupings; they are not six independently operating agents. Do not create agent-to-agent edges or imply that House Agents communicate with one another.

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
| `POST /api/agents/{agentId}/launch`; `POST /api/agents/{agentId}/lifecycle`; `POST /api/agents/{agentId}/fork` | Authenticated, owner-scoped | Launch after a matching complete backtest; pause/resume/stop transitions; fork creates a fresh draft without copied paper state. | Derive only the generic lifecycle capability. Never fetch user instances or current statuses into the public graph. |

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

The supported lifecycle model is: a valid saved recipe starts as `draft`; a draft may be stopped or launched to `running` only after a matching complete backtest; `running` may move to `paused` or `stopped`; `paused` may resume to `running` only while its attached matching backtest remains valid, or move to `stopped`; a stopped instance cannot resume. Forking creates a distinct draft with no copied Tape, orders, positions, or backtest. These transitions are backed by authenticated owner-scoped handlers, not public activity data. A landing graph may render this as a generic capability state machine; it must not show counts or claim that a real user agent is in any state.

`HookDefinition.parameters` is typed as `Record<string, unknown>`, not a strict reusable parameter-schema interface. Each current catalog entry supplies descriptor-shaped data, but graph code should treat it as opaque display metadata or explicitly narrow/validate fields before rendering controls. Do not infer an evaluator from a parameter descriptor.

## Suggested frontend graph types

The following is an adapter contract for the landing page, not a new server response. It reuses existing API/domain types and distinguishes data source from graph relationship:

```ts
import type {
  Agent,
  AgentDecision,
  HookDefinition,
  HookResult,
  HookStage,
  HouseAgentTemplate,
  PublicTapeResponse,
} from "@/lib/domain/contracts";

export type GraphHookAvailability = HookDefinition["availability"];
export type GraphHookEvaluationStatus = HookResult["status"];
export type GraphStageId = `stage:${HookStage}`;

export type GraphEvaluation =
  | {
      kind: "capability";
      hookId: string;
      availability: GraphHookAvailability;
      source: "public_hooks_api";
      actualOutcome?: never;
    }
  | {
      kind: "recorded";
      result: Pick<HookResult, "hookId" | "status" | "reason" | "stage">;
      source: "public_tape_api";
      actualActivity: true;
    }
  | {
      kind: "illustrative";
      hookId: string;
      status?: GraphHookEvaluationStatus;
      reason?: string;
      source: "illustrative";
      actualActivity: false;
      label: "Illustrative only";
    };

export type GraphNode =
  | {
      id: `agent-template:${HouseAgentTemplate["id"]}`;
      kind: "house_agent_template";
      template: HouseAgentTemplate;
      displaySummary?: { text: string; source: "product_copy" };
      isUserInstance: false;
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
      id: `evaluation:${string}`;
      kind: "hook_evaluation";
      evaluation: GraphEvaluation;
    }
  | {
      id: "risk-guard:protective_put";
      kind: "risk_guard";
      stage: "breaker";
      hookIds: readonly string[];
      source: "shared_recipe_registry";
    }
  | {
      id: "decision:paper";
      kind: "paper_decision_capability";
      executionMode: "PAPER";
      actualDecisionId?: never;
      source: "capability_model";
    }
  | {
      id: "tape:optra";
      kind: "tape";
      decisionCount: PublicTapeResponse["decisions"]["length"];
      source: "public_tape_api";
    }
  | {
      id: `lifecycle:${Agent["status"]}`;
      kind: "lifecycle_state";
      status: Agent["status"];
      representation: "capability_state_machine";
      actualAgentId?: never;
    }

export type GraphEdgeKind =
  | "agent_expands_to_stage"
  | "stage_contains_hook"
  | "agent_uses_recipe"
  | "recipe_uses_hook"
  | "hook_has_evaluator"
  | "breaker_protects_entry"
  | "guard_gates_paper_decision"
  | "paper_decision_writes_tape"
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
      kind: "recorded";
      source: "/api/public/v1/tape";
      actualActivity: true;
      records: Array<{
        responseIndex: number;
        action: AgentDecision["action"];
        reason: string;
        executionMode: "PAPER";
        evaluations: Array<Pick<HookResult, "hookId" | "status" | "reason" | "stage">>;
      }>;
    }
  | {
      kind: "illustrative";
      source: "illustrative";
      actualActivity: false;
      label: "Illustrative only";
      steps: Array<{
        hookId: string;
        status?: GraphHookEvaluationStatus;
        label: string;
        illustrative: true;
      }>;
    };

export interface AgentIntelligenceGraphData {
  visibility: "public_capability";
  rootAgentId: "agent-template:protective_put";
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

The root identity is the selected `protective_put` House Agent template (`isUserInstance: false`). The other three template nodes are overview/Preview nodes, not active instances. `conceptual_stage_order` and lifecycle edges are capability-diagram relationships, not timestamped events. The Risk Guard is a guard layer around the flow, not a seventh stage or a final evaluator that runs only after the other stages. There is deliberately no `agent_to_agent` edge kind.

## Supported Protective Put topology

Build the progressive graph from these relationships:

1. Add four `house_agent_template` nodes from `/api/public/v1/templates`; preserve each returned `availability` and `reason`. Set the root to `agent-template:protective_put`. This is a public template identity, not a user agent.
2. Add `recipe:protective_put` because Protective Put is the only `paper_ready` template. Populate its membership from `PAPER_PROTECTIVE_PUT_HOOK_IDS`; it matches the IDs used by `buildProtectivePutRecipe` and the validator.
3. Add six `stage` nodes from the hook catalog's expected stage counts and the `HookStage` union. Connect only the selected root to these stages. These are taxonomy nodes, not agent nodes.
4. Add one `hook` node for each of the 36 returned definitions. Preserve `availability`, `summary`, `implementationNote`, `unavailableReason`, and parameter metadata. Add `stage_contains_hook` edges for all catalog entries.
5. Add `recipe_uses_hook` edges only for the 15 canonical Protective Put hook IDs. Add an evaluation-capability reference for each hook using its catalog `availability`; `implemented` means an evaluator exists, not that it produced a recorded result.
6. Add one `risk_guard:protective_put` grouping node for the five mandatory Breakers (`haltr`, `daylo`, `drawra`, `exposa`, `venux`). Connect those Breaker hook/evaluation nodes to the guard, then connect the guard to the paper-decision capability node. Show this as a conceptual guard relationship: Breakers gate new entries and are not five more agents.
7. Connect the paper-decision capability node to the Optra Tape node. Set the Tape node's record count from `/api/public/v1/tape`; it is currently zero. Use a recorded evaluation/decision reference only if that public response actually contains an explicitly public record.
8. Keep the other three Preview templates unconnected to recipe/hook nodes because their recipe definitions are not exposed or paper-ready.

The headline flow is a progressive visual expansion, not an execution trace. The six stages, evaluator availability, Breaker guard and Tape destination are actual product concepts. Public deterministic outcomes are unavailable: authenticated `AgentDecision.hookResults` are owner-private, and there is no public tick-evaluation endpoint.

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

If the visual needs a sample path, use a separate `kind: "illustrative"` item and visibly label the entire path **Illustrative only**. It may show educational pass/block/action wording about rule behavior, but those results are authored examples, not outputs from a public engine run. Do not add a user/agent ID, decision ID, timestamp, observed market value, premium, fill, performance number, or position. No illustration may be serialized as `AgentDecision` or `HookResult`.

### Existing landing-adapter caution

The current `components/marketing/graph-data.ts` adapter creates authored example statuses/reasons and `illustrativeScenarios()`/`illustrativeTicks()` with pass/block verdicts and `open`/`skip` actions. It does not include observed market values. Its per-hook thresholds come from the configured Protective Put recipe assembled with example inputs; label these as example recipe settings if shown. `components/marketing/graph-flow.ts` marks scenarios with `source: "illustrative"` and visibly retains the canonical status in `raw` when it maps a recorded HookResult into a simplified visual verdict. These examples are not API responses, engine-run outputs, or Tape events. Keep them isolated from actual records and keep the **Illustrative only** label visible throughout the path. The marketing page currently calls the same `createPublicHandlers().tape()` implementation as `/api/public/v1/tape`; it returns no decisions. `scenarioFromDecision()` must only receive records from that public source, never authenticated per-agent Tape.

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
| Sample decision/evaluation animation | Illustrative only | Prominent `Illustrative only` label; educational verdicts/actions are authored examples, never recorded outcomes. No invented observed market values or performance data. |
| Existing `EXAMPLE_TEXT`, `illustrativeScenarios()` and `illustrativeTicks()` in `components/marketing/graph-data.ts` | Frontend-authored illustration | The adapter has no observed prices; sample verdicts/actions are not engine-run evaluations or Tape records. Recipe thresholds use an example recipe configuration. Keep a persistent visible label and a separate source/type. |
| Historical candles/options activity | Not graph activity data | Underlying candle history is real only where coverage verifies; premiums are modeled. Never animate a candle or model value as a live/public trade. |
| Agent-to-agent communication | Not a product relationship in this contract | Do not create or label such edges. |

## Missing information

- The public template payload does not include hook membership or a full `RecipeV1`; the exported Protective Put hook-ID constant supplies membership without adding an endpoint.
- `HouseAgentTemplate` exposes ID, name, availability, and reason, but no summary field. A short summary may remain authored product copy (as in the current `templateSummaries` map), with no implied user activity or unsupported execution claim. Preserve the API's `availability` and `reason` as the authority for readiness.
- The public hook endpoint has full definitions for all 36 hooks, but the current landing adapter projects implemented recipe hooks to detail rows and catalog-only hooks to only `{ id, name, reason }`. If the graph detail panel needs descriptions, implementation notes, and parameter metadata for catalog-only hooks, map those fields from the existing `HookCatalogResponse`; no backend field or route is missing.
- No public Tape/decision-trace records exist. Real `HookResult` evaluations are private to an owner’s Tape. A public actual trace would require a separately approved visibility/data product; it is outside this integration pass.
- No public tick-evaluation API exists. The public hook catalog reports evaluator availability and descriptions; `POST /api/recipes/validate` checks recipe validity, not runtime outcomes. Do not manufacture a deterministic evaluation result from those metadata endpoints.
- Preview templates expose their names and blocker reasons, not full recipe compositions. Do not draw inferred hook or option-leg memberships for them.
- Hook parameter descriptors are `unknown` values at the shared TypeScript boundary. They can be shown as opaque details; richer interactive controls would need a distinct typed parameter contract.
- Agent lifecycle status is available only on private `Agent` records. The public graph can show the implemented state machine, not real lifecycle counts/current statuses.

## Claude Code integration guidance

1. Use `/api/public/v1/templates` and `/api/public/v1/hooks` in browser fetching. The marketing server page may reuse the same registries through `getGraphData()` and `createPublicHandlers()`; validate payloads with the shared schemas when consuming API responses.
2. Set `rootAgentId` to `agent-template:protective_put`; the root represents the public House Agent template, never a user instance. Keep the three Preview templates as overview nodes without inferred recipes or hook edges.
3. Build all six stage nodes and 36 hook nodes from the public hook catalog. Preserve `HookDefinition.availability`. Add evaluator-capability links from this status, not synthetic `HookResult` records.
4. Preserve the complete catalog details (`summary`, `implementationNote`, `unavailableReason`, and `parameters`) for the hook detail model, including catalog-only hooks. The existing adapter currently discards most of those fields for locked rows; the public API already returns them.
5. Import `PAPER_PROTECTIVE_PUT_HOOK_IDS` for the recipe edges and Breaker guard membership. Do not hardcode the 15 IDs or infer membership by matching names.
6. Template API data has no descriptive summary. Keep any `product_copy` summary separate from API readiness/reason fields, and do not infer a Preview recipe from copy.
7. Use the public Tape handler/endpoint as the trace source. It currently returns no decisions. Keep the actual trace empty; `scenarioFromDecision()` may only receive decisions from that public source. Never load authenticated per-agent Tape for the landing page.
8. If retaining the authored pass/block/open/skip story, keep it typed as `kind: "illustrative"` and visibly labeled **Illustrative only** throughout. Its sample thresholds are example recipe settings; it has no observed market values. Do not present it as a deterministic engine run.
9. Preserve canonical `HookResult.status` when simplifying visuals (the current helper retains it as `raw`). No public evaluation outcomes exist today; private `hookResults` are unavailable to the anonymous graph.
10. Treat stage sequence as layout/storytelling and Breaker as a guard around entry, not a seventh stage or another agent. Do not imply House Agents communicate with one another.
11. Keep all public/private boundaries intact. No backend route, schema, database, auth, engine, or API change is needed for this graph contract.

Source files: `lib/domain/contracts.ts`, `lib/hooks/catalog.ts`, `lib/hooks/handlers.ts`, `lib/hooks/recipe-validator.ts`, `lib/public/handlers.ts`, `lib/paper/handlers.ts`, the corresponding routes under `app/api/public/v1/`, `app/api/hooks/`, `app/api/agents/templates/`, and `app/api/agents/[agentId]/`, plus the existing landing adapter `components/marketing/graph-data.ts` and illustrative flow helper `components/marketing/graph-flow.ts`.
