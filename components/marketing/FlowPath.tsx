import type { ComponentType, CSSProperties } from "react";
import { useId } from "react";

export type FlowNode = { id: string; label: string; sub?: string; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; tone?: "azure" | "ember" };

/* One smooth cubic path through N stations. Every station sits at a fixed percentage of the width, so the HTML nodes
   and the SVG line stay attached at any width. The lit part is clipped to the active station; a block turns it Ember;
   one short signal travels to the active station when the pinned step changes. */

const GAP = 100 / 5;
const x = (index: number) => GAP / 2 + index * GAP;
const Y = [46, 62];
const y = (index: number) => Y[index % 2] ?? 46;

function buildPath(count: number) {
  let d = `M2 ${y(0)} L${x(0)} ${y(0)}`;
  for (let i = 1; i < count; i += 1) {
    const mid = (x(i - 1) + x(i)) / 2;
    d += ` C${mid} ${y(i - 1)} ${mid} ${y(i)} ${x(i)} ${y(i)}`;
  }
  return `${d} L98 ${y(count - 1)}`;
}

export function FlowPath({ nodes, active, stop = null, guard = false, guardActive = false, height = 150 }: { nodes: FlowNode[]; active: number; stop?: number | null; guard?: boolean; guardActive?: boolean; height?: number }) {
  const uid = useId().replace(/:/g, "");
  const d = buildPath(nodes.length);
  const reach = (index: number) => (index < 0 ? 0 : x(Math.min(index, nodes.length - 1)));
  const litTo = reach(stop !== null && active >= stop ? stop : active);
  const emberTo = stop !== null && active > stop ? reach(active) : 0;
  const pulseTo = (reach(active) - 2) / 96;
  const room = nodes.some((node) => node.sub) ? 112 : 94;
  const railY = Math.max(...nodes.map((_, index) => y(index))) + room + 16;
  const total = guard ? railY + 36 : height;

  return (
    <div className="fp" style={{ height: total, "--f": Math.max(0.02, Math.min(1, pulseTo)) } as CSSProperties} data-guard={guard ? "1" : "0"} data-guard-active={guardActive ? "1" : "0"}>
      <svg className="fp-svg" viewBox={`0 0 100 ${total}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id={`${uid}-lit`}><rect className="fp-clip" x="0" y="0" height={total} style={{ width: `${litTo + 1}px` }} /></clipPath>
          <clipPath id={`${uid}-ember`}><rect className="fp-clip" x="0" y="0" height={total} style={{ width: `${emberTo + 1}px` }} /></clipPath>
        </defs>
        {guard ? nodes.map((node, index) => <path key={node.id} className="fp-tick" d={`M${x(index)} ${y(index) + room} L${x(index)} ${railY}`} />) : null}
        {guard ? <path className="fp-rail" d={`M2 ${railY} L98 ${railY}`} /> : null}
        <path className="fp-base" d={d} />
        {emberTo > 0 ? <path className="fp-ember" d={d} clipPath={`url(#${uid}-ember)`} /> : null}
        <path className="fp-lit" d={d} clipPath={`url(#${uid}-lit)`} />
        {nodes.length > 0 ? <path className="fp-pulse" d={d} pathLength={1} key={`${active}-${stop}`} /> : null}
      </svg>
      <ol className="fp-nodes">
        {nodes.map((node, index) => {
          const Icon = node.icon;
          const state = index === active ? "active" : index < active ? "done" : "next";
          const blocked = stop === index && active >= index;
          return (
            <li key={node.id} style={{ left: `${x(index)}%`, top: y(index) }} data-state={state} data-block={blocked ? "1" : "0"} data-tone={node.tone ?? "azure"} aria-current={index === active ? "step" : undefined}>
              <span className="fp-node"><Icon aria-hidden /></span>
              <span className="fp-label">{node.label}</span>
              {node.sub ? <span className="fp-sub">{node.sub}</span> : null}
            </li>
          );
        })}
      </ol>
      {guard ? <p className="fp-guard-label mono" style={{ top: railY + 10 }}>BREAKER · GUARDS EVERY STAGE</p> : null}
    </div>
  );
}
