// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentGallery } from "../../components/app/agents/AgentGallery";

describe("agent gallery controls", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps Search and Refresh together and preserves the refresh action", async () => {
    const onRetry = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    render(createElement(AgentGallery, {
      owned: [],
      ownedStatus: "ready",
      ownedError: "",
      signedIn: true,
      onRetry,
      selected: "protective_put",
      onSelect: vi.fn(),
    }));

    const search = screen.getByLabelText("Search agents");
    const refresh = screen.getByRole("button", { name: "Refresh" });
    const controls = search.closest(".ag-search-row");

    expect(controls).not.toBeNull();
    expect(controls?.contains(refresh)).toBe(true);

    await userEvent.setup().click(refresh);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
