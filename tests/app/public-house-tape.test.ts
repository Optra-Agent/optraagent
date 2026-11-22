// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicHouseTape } from "../../components/app/tape/PublicHouseTape";

const RECIPE = `sha256:${"3e".repeat(32)}`;
const DATA = `sha256:${"9f".repeat(32)}`;
const scheduler = (overrides: Record<string, unknown> = {}) => ({
  intervalMinutes: 10, finalizationGraceMinutes: 5, checkedAt: "2026-11-22T00:20:00.000Z", marketOpen: false, marketClosedReason: "weekend",
  nextEligibleCandleEndAt: "2026-11-23T15:00:00.000Z", nextEvaluationNotBeforeAt: "2026-11-23T15:05:00.000Z", heartbeat: null, ...overrides,
});
const decision = (id: string, action: string, hookStatus: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id, agentId: "bbf8e466-8801-4d9f-b587-3d343e915783", tickId: `replay-${id}`, action, reason: `${action} because of a rule`,
  hookResults: [{ hookId: hookStatus === "error" ? "system.market_data" : "volra", status: hookStatus, reason: "rule evidence" }],
  marketContext: { observation: { endAt: createdAt }, historyDataHash: DATA, historyWindow: { startAt: "2026-10-22T00:00:00.000Z", endAt: createdAt, candles: 721 } },
  snapshotSource: "crius_robinhood_chain_candles", recipeHash: RECIPE, createdAt, agentName: "Covered Call NVDA", underlyingSymbol: "NVDA", templateId: "covered_call", ...extra,
});

function serve(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

describe("PublicHouseTape", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("explains an empty Tape on a weekend with the exact next eligible tick", async () => {
    serve({ decisions: [], orders: [], executionMode: "PAPER", scheduler: scheduler() });
    render(createElement(PublicHouseTape));

    const status = await screen.findByTestId("scheduler-status");
    expect(status.textContent).toMatch(/US market closed \(the weekend\)/);
    expect(status.textContent).toMatch(/an empty Tape is expected right now/);
    expect(status.textContent).toMatch(/23 Nov 2026 · 15:00 UTC/);
    expect(status.textContent).toMatch(/23 Nov 2026 · 15:05 UTC/);
    expect(status.textContent).toMatch(/first pass is pending|not reported/);
    expect(screen.getByText("No decisions have been persisted yet.")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/public/v1/tape?limit=100");
  });

  it("shows each persisted decision with agent, strategy, timestamp, outcome, hooks and data provenance, and filters by outcome including ERROR", async () => {
    serve({
      decisions: [
        decision("a", "open", "pass", "2026-11-23T16:00:00.000Z"),
        decision("b", "skip", "error", "2026-11-23T15:00:00.000Z"),
        decision("c", "hold", "block", "2026-11-23T14:00:00.000Z"),
      ],
      orders: [], executionMode: "PAPER",
      scheduler: scheduler({ marketOpen: true, marketClosedReason: null, heartbeat: { startedAt: "2026-11-23T14:20:00.000Z", lastPassAt: "2026-11-23T16:10:05.000Z", lastPassDurationMs: 6000, lastPass: { status: "complete", agentsConsidered: 5, evaluated: 4, opened: 1, skipped: 0, duplicates: 0, deferred: 1, dataErrors: 1, failures: 0 } } }),
    });
    const user = userEvent.setup();
    render(createElement(PublicHouseTape));

    const rows = await screen.findAllByRole("article");
    expect(rows).toHaveLength(3);
    const first = rows[0]!;
    expect(first.querySelector('[data-slot="badge"]')?.textContent).toBe("open");
    expect(within(first).getByRole("link", { name: "Covered Call NVDA" }).getAttribute("href")).toBe("/house/bbf8e466-8801-4d9f-b587-3d343e915783");
    expect(first.textContent).toMatch(/Covered Call · NVDA/);
    expect(first.textContent).toMatch(/23 Nov 2026 · 16:00 UTC/);
    expect(first.textContent).toMatch(/Source crius_robinhood_chain_candles/);
    expect(first.textContent).toMatch(/History sha256:9f9f9f9…9f9f9f \(721 candles\)/);
    expect(first.textContent).toMatch(/Recipe sha256:3e3e3e3…3e3e3e/);
    expect(first.querySelector("details.trace")).not.toBeNull();

    // The skip carrying an error hook is an ERROR outcome, not a plain skip.
    expect(rows[1]!.querySelector('[data-slot="badge"]')?.textContent).toBe("error");
    expect(screen.getByTestId("scheduler-status").textContent).toMatch(/US market open/);
    expect(screen.getByTestId("scheduler-status").textContent).toMatch(/5 agents considered, 4 evaluated, 1 recorded as error/);

    await user.click(screen.getByRole("tab", { name: /Error/ }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(screen.getByRole("article").querySelector('[data-slot="badge"]')?.textContent).toBe("error");
    await user.click(screen.getByRole("tab", { name: /Close/ }));
    expect(await screen.findByText(/No close decisions in the latest 3/)).toBeTruthy();
  });

  it("shows an error state, not an empty Tape, when the public API fails", async () => {
    serve({ error: { code: "INTERNAL_ERROR", message: "Unable to load the public Tape.", retryable: true } }, 500);
    render(createElement(PublicHouseTape));
    expect(await screen.findByText("Public Tape could not be loaded")).toBeTruthy();
    expect(screen.queryByText("No decisions have been persisted yet.")).toBeNull();
  });
});
