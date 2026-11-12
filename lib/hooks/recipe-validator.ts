import { createHash } from "node:crypto";
import { RecipeValidationResultSchema, RecipeV1Schema } from "../domain/contracts";
import type { RecipeV1 } from "../domain/contracts";
import { getHookCatalog } from "./catalog";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalRecipeHash(input: RecipeV1): `sha256:${string}` {
  const recipe = RecipeV1Schema.parse(input);
  const canonical = JSON.stringify(canonicalize(recipe));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function validateRecipe(input: unknown) {
  const parsed = RecipeV1Schema.safeParse(input);
  if (!parsed.success) {
    return RecipeValidationResultSchema.parse({
      valid: false,
      recipeHash: null,
      issues: [{ code: "INVALID_RECIPE", message: "Recipe does not match the RecipeV1 schema." }],
    });
  }

  const recipe = parsed.data;
  const issues: Array<{
    code: "HOOK_CATALOG_UNAVAILABLE" | "UNSUPPORTED_HOOK" | "DUPLICATE_HOOK_ID" | "MISSING_REQUIRED_HOOK" | "INVALID_COMPOSITION" | "INVALID_PARAMETER";
    message: string;
    hookId?: string;
  }> = [];
  const catalog = getHookCatalog();
  const knownHooks = new Map(catalog.definitions.map((definition) => [definition.id, definition]));

  if (catalog.coverage.sourceStatus === "source_unavailable") {
    issues.push({
      code: "HOOK_CATALOG_UNAVAILABLE" as const,
      message: catalog.coverage.unavailableReason ?? "The PM hook catalog is unavailable.",
    });
  }

  const seen = new Set<string>();
  for (const hookId of recipe.hookIds) {
    if (seen.has(hookId)) {
      issues.push({ code: "DUPLICATE_HOOK_ID" as const, hookId, message: `Hook ${hookId} appears more than once.` });
      continue;
    }
    seen.add(hookId);
    const definition = knownHooks.get(hookId);
    if (!definition || definition.availability !== "implemented") {
      issues.push({ code: "UNSUPPORTED_HOOK" as const, hookId, message: `Hook ${hookId} has no verified evaluator.` });
    }
  }

  const hookStages = new Map(catalog.definitions.map((definition) => [definition.id, definition.stage]));
  const hooksByStage = new Map<string, number>();
  for (const hookId of recipe.hookIds) {
    const stage = hookStages.get(hookId);
    if (stage) hooksByStage.set(stage, (hooksByStage.get(stage) ?? 0) + 1);
  }
  if (recipe.hookIds.length === 0 && catalog.coverage.sourceStatus === "available") {
    issues.push({ code: "UNSUPPORTED_HOOK", message: "A recipe requires at least one implemented hook." });
  }

  if ((hooksByStage.get("gate") ?? 0) > 5 || (hooksByStage.get("pulse") ?? 0) > 7 || (hooksByStage.get("breaker") ?? 0) !== 5) {
    issues.push({ code: "INVALID_COMPOSITION", message: "Recipe exceeds a PM stage limit or omits a mandatory Breaker." });
  }

  if (recipe.templateId !== "protective_put") {
    issues.push({ code: "INVALID_COMPOSITION", message: "Only the PM Protective Put has a supported paper evaluator in this release." });
  } else {
    const required = ["calmo", "corpax", "sessia", "percy", "tenora", "coverix", "capra", "trailo", "lastra", "nextra", "haltr", "daylo", "drawra", "exposa", "venux"];
    for (const hookId of required) {
      if (!seen.has(hookId)) issues.push({ code: "MISSING_REQUIRED_HOOK", hookId, message: `Protective Put requires ${hookId}.` });
    }
    const selectors = recipe.hookIds.filter((hookId) => ["percy", "deltra"].includes(hookId));
    const structures = recipe.hookIds.filter((hookId) => ["spreadix", "strangl", "collara"].includes(hookId));
    if (selectors.length !== 1 || structures.length !== 0) {
      issues.push({ code: "INVALID_COMPOSITION", message: "Protective Put requires one single-leg strike selector and no multi-leg structure." });
    }
    const parameters = recipe.parameters;
    const percy = objectRecord(parameters.percy);
    const sessia = objectRecord(parameters.sessia);
    const capra = objectRecord(parameters.capra);
    const coverix = objectRecord(parameters.coverix);
    const model = objectRecord(parameters.paperModel);
    const protectedShares = positiveNumber(parameters.protectedShares);
    const initialCapital = positiveNumber(parameters.initialCapitalUsd);
    if (percy?.type !== "put" || percy.side !== "buy") {
      issues.push({ code: "INVALID_COMPOSITION", hookId: "percy", message: "The supported Protective Put buys a put; short legs are not supported." });
    }
    if (!Array.isArray(sessia?.sessions) || sessia.sessions.length !== 1 || sessia.sessions[0] !== "regular" || sessia.appliesTo !== "entries") {
      issues.push({ code: "INVALID_PARAMETER", hookId: "sessia", message: "Protective Put entries are restricted to the regular US equity session." });
    }
    if (!protectedShares || !initialCapital || coverix?.coveragePct !== 100 || capra?.maxOpenPositions !== 1) {
      issues.push({ code: "INVALID_PARAMETER", message: "Protective Put needs positive paper capital and reference shares, 100% coverage, and one open position." });
    }
    if (model?.model !== "black_scholes_european_put" || model.premiumSource !== "modeled" || model.ivMultiplier !== 1.1 || model.venueFeesIncluded !== false) {
      issues.push({ code: "INVALID_PARAMETER", message: "Protective Put must use the documented RV30 × 1.1 model and disclose excluded venue fees." });
    }
  }

  return RecipeValidationResultSchema.parse({
    valid: issues.length === 0,
    recipeHash: canonicalRecipeHash(recipe),
    issues,
  });
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function positiveNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
