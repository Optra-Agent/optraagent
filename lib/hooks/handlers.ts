import { ApiErrorSchema, HookCatalogResponseSchema, RecipeValidationResultSchema } from "../domain/contracts";
import { getHookCatalog } from "./catalog";
import { validateRecipe } from "./recipe-validator";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function validationError(): Response {
  return json(ApiErrorSchema.parse({
    error: { code: "VALIDATION_ERROR", message: "A JSON recipe body is required.", retryable: false },
  }), 400);
}

export function createHookHandlers() {
  return {
    async list(): Promise<Response> {
      return json(HookCatalogResponseSchema.parse(getHookCatalog()));
    },

    async validate(request: Request): Promise<Response> {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return validationError();
      }
      return json(RecipeValidationResultSchema.parse(validateRecipe(body)));
    },
  };
}
