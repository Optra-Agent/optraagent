"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_PARAMS, clampParams, type FloorParams } from "./payoff";
import type { FloorView } from "./floor-scene";

/** One small store shared by the hero visual and the Protective Floor controls, so both always show the same two assumptions. */
type State = { params: FloorParams; view: FloorView; gl: "pending" | "ready" | "off" };

let state: State = { params: DEFAULT_PARAMS, view: "overview", gl: "pending" };
const listeners = new Set<() => void>();

export const floorStore = {
  get: () => state,
  set(next: Partial<State>) {
    state = { ...state, ...next, params: next.params ? clampParams(next.params) : state.params };
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useFloor(): State {
  return useSyncExternalStore(floorStore.subscribe, floorStore.get, floorStore.get);
}
