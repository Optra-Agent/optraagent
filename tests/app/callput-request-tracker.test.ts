// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publicClient: null as unknown,
  setWalletMenuOpen: vi.fn(),
}));

vi.mock("wagmi", () => ({
  usePublicClient: () => mocks.publicClient,
  useAccount: () => ({ address: undefined, chainId: undefined, isConnected: false }),
  useWalletClient: () => ({ data: undefined }),
}));
vi.mock("../../components/app/AuthSessionProvider", () => ({
  useAuthSession: () => ({ status: "signed_out", setWalletMenuOpen: mocks.setWalletMenuOpen }),
}));

import { CallPutRequestTracker } from "../../components/app/tape/CallPutRequestTracker";
import { TapeScreen } from "../../components/app/tape/TapeScreen";

const REQUEST_KEY = `0x${"ab".repeat(32)}`;
const PENDING_OPEN = [
  "0x0000000000000000000000000000000000000011",
  16,
  1_800_000_000n,
  42n,
  100n,
  5_000_000n,
  75n,
  false,
  1_700_000_000n,
  0,
  0n,
  0n,
  0n,
  0n,
] as const;
const CANCELLED_OPEN = [
  "0x0000000000000000000000000000000000000011",
  16,
  1_800_000_000n,
  42n,
  100n,
  5_000_000n,
  75n,
  false,
  1_700_000_000n,
  1,
  0n,
  0n,
  0n,
  0n,
] as const;
const EXECUTED_CLOSE = [
  "0x0000000000000000000000000000000000000011",
  16,
  1_800_000_000n,
  42n,
  100n,
  4_000_000n,
  75n,
  false,
  1_700_000_000n,
  2,
  4_100_000n,
  123n,
  1_700_000_030n,
] as const;
const NOT_FOUND_OPEN = [
  "0x0000000000000000000000000000000000000000",
  0,
  0n,
  0n,
  0n,
  0n,
  0n,
  false,
  0n,
  0,
  0n,
  0n,
  0n,
  0n,
] as const;

describe("CallPut request tracker", () => {
  let readContract: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    readContract = vi.fn().mockResolvedValue(PENDING_OPEN);
    mocks.publicClient = {
      getChainId: vi.fn().mockResolvedValue(4663),
      readContract,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("does not read automatically and keeps venue requests separate from Paper", () => {
    render(createElement(CallPutRequestTracker));

    expect(screen.getByRole("region", { name: "CallPut request tracker" })).toBeTruthy();
    expect(screen.getByText(/read-only/i)).toBeTruthy();
    expect(screen.getByText(/does not create a paper fill/i)).toBeTruthy();
    expect(readContract).not.toHaveBeenCalled();
  });

  it("keeps the CallPut monitor available without a selected Paper agent", () => {
    render(createElement(TapeScreen, { agentId: "" }));

    expect(screen.getByRole("region", { name: "CallPut request tracker" })).toBeTruthy();
  });

  it("offers manual refresh after reading request evidence", async () => {
    const user = userEvent.setup();
    render(createElement(CallPutRequestTracker));

    await user.type(screen.getByLabelText("Request key (bytes32)"), REQUEST_KEY);
    await user.click(screen.getByRole("button", { name: "Read request" }));
    await waitFor(() => expect(readContract).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Refresh request" }));
    await waitFor(() => expect(readContract).toHaveBeenCalledTimes(2));
  });

  it("clears prior evidence when the lookup key changes", async () => {
    const user = userEvent.setup();
    render(createElement(CallPutRequestTracker));

    const input = screen.getByLabelText("Request key (bytes32)");
    await user.type(input, REQUEST_KEY);
    await user.click(screen.getByRole("button", { name: "Read request" }));
    await waitFor(() => expect(screen.getByText(REQUEST_KEY)).toBeTruthy());

    await user.clear(input);
    await user.type(input, `0x${"cd".repeat(32)}`);

    expect(screen.queryByText(REQUEST_KEY)).toBeNull();
    expect(readContract).toHaveBeenCalledTimes(1);
  });

  it("does not show stale evidence when the lookup key changes during a read", async () => {
    let resolveRead!: (value: unknown) => void;
    readContract.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    const user = userEvent.setup();
    render(createElement(CallPutRequestTracker));

    const input = screen.getByLabelText("Request key (bytes32)");
    await user.type(input, REQUEST_KEY);
    await user.click(screen.getByRole("button", { name: "Read request" }));
    await waitFor(() => expect(readContract).toHaveBeenCalledTimes(1));

    await user.clear(input);
    await user.type(input, `0x${"cd".repeat(32)}`);
    await act(async () => { resolveRead(PENDING_OPEN); });

    expect(screen.queryByText(REQUEST_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Read request" }).hasAttribute("disabled")).toBe(false);
  });

  it("clears prior evidence when the request type changes", async () => {
    const user = userEvent.setup();
    render(createElement(CallPutRequestTracker));

    await user.type(screen.getByLabelText("Request key (bytes32)"), REQUEST_KEY);
    await user.click(screen.getByRole("button", { name: "Read request" }));
    await waitFor(() => expect(screen.getByText(REQUEST_KEY)).toBeTruthy());

    await user.selectOptions(screen.getByLabelText("Request type"), "close");

    expect(screen.queryByText(REQUEST_KEY)).toBeNull();
    expect(readContract).toHaveBeenCalledTimes(1);
  });

  it("shows Pending request inputs without presenting zero outputs as a fill", async () => {
    const user = userEvent.setup();
    render(createElement(CallPutRequestTracker));

    await user.type(screen.getByLabelText("Request key (bytes32)"), REQUEST_KEY);
    await user.click(screen.getByRole("button", { name: "Read request" }));

    await waitFor(() => expect(screen.getByText("Pending")).toBeTruthy());
    expect(screen.getByText("5000000")).toBeTruthy();
    expect(screen.getByText(/no fill is claimed/i)).toBeTruthy();
    expect(screen.queryByText(/Amount out \(raw units\)/i)).toBeNull();
  });

  it("shows only the returned execution fields for an Executed close request", async () => {
    readContract.mockResolvedValue(EXECUTED_CLOSE);
    const user = userEvent.setup();
    render(createElement(CallPutRequestTracker));

    await user.selectOptions(screen.getByLabelText("Request type"), "close");
    await user.type(screen.getByLabelText("Request key (bytes32)"), REQUEST_KEY);
    await user.click(screen.getByRole("button", { name: "Read request" }));

    await waitFor(() => expect(screen.getByText("Executed")).toBeTruthy());
    expect(screen.getByText("4100000")).toBeTruthy();
    expect(screen.getByText("123")).toBeTruthy();
    expect(screen.getByText(/not separate settlement confirmation/i)).toBeTruthy();
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "closePositionRequests" }));
  });

  it("shows Cancelled without reporting execution outputs as a fill", async () => {
    readContract.mockResolvedValue(CANCELLED_OPEN);
    const user = userEvent.setup();
    render(createElement(CallPutRequestTracker));

    await user.type(screen.getByLabelText("Request key (bytes32)"), REQUEST_KEY);
    await user.click(screen.getByRole("button", { name: "Read request" }));

    await waitFor(() => expect(screen.getByText("Cancelled")).toBeTruthy());
    expect(screen.getByText(/no fill is reported/i)).toBeTruthy();
    expect(screen.queryByText(/Amount out \(raw units\)/i)).toBeNull();
  });

  it("shows Not found for an empty request slot and hides empty account data", async () => {
    readContract.mockResolvedValue(NOT_FOUND_OPEN);
    const user = userEvent.setup();
    render(createElement(CallPutRequestTracker));

    await user.type(screen.getByLabelText("Request key (bytes32)"), REQUEST_KEY);
    await user.click(screen.getByRole("button", { name: "Read request" }));

    await waitFor(() => expect(screen.getByText("Not found")).toBeTruthy());
    expect(screen.getByText(/no request record found/i)).toBeTruthy();
    expect(screen.queryByText("Venue account")).toBeNull();
  });

  it("rejects a request key that is not bytes32 before reading the contract", async () => {
    const user = userEvent.setup();
    render(createElement(CallPutRequestTracker));

    await user.type(screen.getByLabelText("Request key (bytes32)"), "0x123");
    await user.click(screen.getByRole("button", { name: "Read request" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/bytes32/i);
    expect(screen.getByLabelText("Request key (bytes32)").getAttribute("aria-invalid")).toBe("true");
    expect(readContract).not.toHaveBeenCalled();
    expect((mocks.publicClient as { getChainId: ReturnType<typeof vi.fn> }).getChainId).not.toHaveBeenCalled();
  });

  it("surfaces a wrong-chain error without reading venue state", async () => {
    (mocks.publicClient as { getChainId: ReturnType<typeof vi.fn> }).getChainId.mockResolvedValue(1);
    const user = userEvent.setup();
    render(createElement(CallPutRequestTracker));

    await user.type(screen.getByLabelText("Request key (bytes32)"), REQUEST_KEY);
    await user.click(screen.getByRole("button", { name: "Read request" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/4663/);
    expect(screen.getByLabelText("Request key (bytes32)").getAttribute("aria-invalid")).not.toBe("true");
    expect(readContract).not.toHaveBeenCalled();
  });
});
