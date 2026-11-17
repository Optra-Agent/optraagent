import { ENTRY, PRICE_FROM, PRICE_TO, floorColumns, floorReadout, type FloorParams } from "./payoff";

const W = 560;
const H = 320;
const PAD = { l: 44, r: 20, t: 18, b: 40 };
const V_MAX = 145;

/**
 * The same arithmetic as the 3D floor, as a flat chart. It is what shows when WebGL is off, and it is a plain description of the idea:
 * the grey line is the holding alone, the azure line is the holding with a long put, and the vermilion band is the floor the put supplies.
 */
export function FloorDiagram({ params, className }: { params: FloorParams; className?: string }) {
  const columns = floorColumns(params, 41);
  const x = (price: number) => PAD.l + ((price - PRICE_FROM) / (PRICE_TO - PRICE_FROM)) * (W - PAD.l - PAD.r);
  const y = (value: number) => H - PAD.b - (Math.max(0, value) / V_MAX) * (H - PAD.t - PAD.b);
  const line = (pick: (column: (typeof columns)[number]) => number) => columns.map((column, index) => `${index === 0 ? "M" : "L"}${x(column.price).toFixed(1)} ${y(pick(column)).toFixed(1)}`).join(" ");
  const { floor, worstLoss } = floorReadout(params);
  const band = columns.filter((column) => column.put > 0);
  const bandPath = band.length
    ? `${band.map((column, index) => `${index === 0 ? "M" : "L"}${x(column.price).toFixed(1)} ${y(column.net).toFixed(1)}`).join(" ")} ${band.slice().reverse().map((column) => `L${x(column.price).toFixed(1)} ${y(column.holding).toFixed(1)}`).join(" ")} Z`
    : "";

  return (
    <svg className={className ? `fd ${className}` : "fd"} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Payoff at expiry per 100 of entry value. Without the put, value falls with the price. With the put, it stops at ${floor.toFixed(1)}, a largest loss of ${worstLoss.toFixed(1)}.`}>
      <line className="fd-axis" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
      <line className="fd-entry" x1={PAD.l} x2={W - PAD.r} y1={y(ENTRY)} y2={y(ENTRY)} />
      <text className="fd-tick" x={PAD.l - 8} y={y(ENTRY) + 4} textAnchor="end">100</text>
      <text className="fd-tick" x={PAD.l} y={H - PAD.b + 22} textAnchor="start">{PRICE_FROM}</text>
      <text className="fd-tick" x={x(100)} y={H - PAD.b + 22} textAnchor="middle">100</text>
      <text className="fd-tick" x={W - PAD.r} y={H - PAD.b + 22} textAnchor="end">{PRICE_TO}</text>
      <text className="fd-axis-label" x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle">Price at expiry</text>
      {bandPath ? <path className="fd-band" d={bandPath} /> : null}
      <path className="fd-hold" d={line((column) => column.holding)} />
      <path className="fd-net" d={line((column) => column.net)} />
      <line className="fd-floor" x1={PAD.l} x2={W - PAD.r} y1={y(floor)} y2={y(floor)} />
      <text className="fd-floor-label" x={W - PAD.r} y={y(floor) - 8} textAnchor="end">Floor {floor.toFixed(1)}</text>
    </svg>
  );
}
