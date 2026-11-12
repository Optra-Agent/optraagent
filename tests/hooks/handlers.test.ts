import { describe, expect, it } from "vitest";
import { createHookHandlers } from "../../lib/hooks/handlers";

describe("hook and recipe API handlers", () => {
  it("returns_the_shared_catalog_coverage_contract", async () => {
    const response = await createHookHandlers().list();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      coverage: { sourceStatus: "available", expectedCount: 36, registeredCount: 36 },
      definitions: expect.arrayContaining([
        expect.objectContaining({ id: "calmo", availability: "implemented" }),
        expect.objectContaining({ id: "volra", availability: "catalog_only" }),
      ]),
    });
  });

  it("validates_without_persisting_and_rejects_malformed_input", async () => {
    const handlers = createHookHandlers();
    const response = await handlers.validate(new Request("http://localhost/api/recipes/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1, name: "Preview", templateId: "custom", underlyingSymbol: "AAPL", hookIds: [], parameters: {} }),
    }));
    const malformed = await handlers.validate(new Request("http://localhost/api/recipes/validate", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{bad json",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ valid: false, recipeHash: expect.stringMatching(/^sha256:/) });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});
