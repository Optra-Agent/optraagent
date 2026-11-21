import type { PositionChange, StrategyPosition } from "./types";

/**
 * Applies one tick's position changes to an in-memory portfolio. The backtest replay and the engine tests use this so
 * they evolve state exactly as the persisted paper path does: new positions get an id, updates replace by id, and a
 * closed position leaves the open set.
 */
export function applyPositionChanges(
  positions: readonly StrategyPosition[],
  changes: readonly PositionChange[],
  newId: (key: string) => string,
): StrategyPosition[] {
  const byId = new Map<string, StrategyPosition>();
  positions.forEach((position, index) => byId.set(position.id ?? `existing:${index}`, position));
  for (const change of changes) {
    if (change.action === "open") {
      const id = newId(change.key);
      byId.set(id, { ...change.position, id });
    } else if (change.action === "update") {
      byId.set(change.key, { ...change.position, id: change.position.id ?? change.key });
    } else {
      byId.delete(change.key);
    }
  }
  return [...byId.values()].filter((position) => position.status === "open");
}
