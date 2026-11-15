import { describe, expect, it } from "vitest";
import { getGraphData } from "../../components/marketing/graph-data";
import { buildLayout, VIEW } from "../../components/marketing/network-layout";

describe("agent network layout", () => {
  const layout = buildLayout(getGraphData());
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  it("has one root, five stages, fifteen hooks, five locked satellites, a decision and the Tape", () => {
    const count = (kind: string) => layout.nodes.filter((node) => node.kind === kind).length;
    expect(layout.nodes.filter((node) => node.phase === 0).map((node) => node.id)).toEqual(["root"]);
    expect([count("stage"), count("hook") + count("risk"), count("risk"), count("locked"), count("decision"), count("tape")]).toEqual([5, 15, 5, 5, 1, 1]);
  });

  it("grows through six distinct states: stages, hooks, Breaker, decision, and Tape", () => {
    expect(layout.nodes.filter((node) => node.kind === "stage").map((node) => node.phase).sort()).toEqual([1, 1, 1, 1, 1]);
    expect(layout.nodes.filter((node) => node.kind === "hook" || node.kind === "locked").map((node) => node.phase).every((phase) => phase === 2)).toBe(true);
    expect(layout.nodes.filter((node) => node.kind === "risk").map((node) => node.phase).every((phase) => phase === 3)).toBe(true);
    for (const edge of layout.edges.filter((row) => row.kind === "branch" || row.kind === "hook" || row.kind === "lock")) {
      const parent = edge.from === "root" ? layout.nodes[0]! : byId.get(edge.from)!;
      const child = byId.get(edge.to)!;
      expect(child.phase).toBeGreaterThanOrEqual(parent.phase);
      expect(child.from).toEqual({ x: child.x, y: child.y });
      expect(child.delay, `${child.id} should bloom after its branch starts`).toBeGreaterThanOrEqual(edge.delay + 600);
    }
    expect(byId.get("decision")!.phase).toBe(4);
    expect(byId.get("tape")!.phase).toBe(5);
    expect(layout.ring.phase).toBe(3);
  });

  it("keeps every node inside the canvas and never lets two nodes overlap", () => {
    const margin = 4;
    for (const node of layout.nodes) {
      expect(node.x - node.w / 2).toBeGreaterThanOrEqual(0);
      expect(node.x + node.w / 2).toBeLessThanOrEqual(VIEW.w);
      expect(node.y - node.h / 2).toBeGreaterThanOrEqual(0);
      expect(node.y + node.h / 2).toBeLessThanOrEqual(VIEW.h);
    }
    for (const [i, a] of layout.nodes.entries()) {
      for (const b of layout.nodes.slice(i + 1)) {
        const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 + margin && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + margin;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("zooms out as the network grows", () => {
    const scales = [0, 1, 2, 3, 4, 5].map((phase) => layout.camera[phase as 0 | 1 | 2 | 3 | 4 | 5].s);
    expect(scales).toEqual([...scales].sort((a, b) => b - a));
    expect(scales[0]).toBeGreaterThan(scales[4]! * 1.4);
  });
});
