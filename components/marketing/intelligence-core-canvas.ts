import { sampleIntelligenceCore } from "./intelligence-core-model";
import type { IntelligenceCoreModel, IntelligenceCorePoint } from "./intelligence-core-model";

const BLUE = "#238cff";
const BLUE_LIGHT = "#a8d8ff";
const EMBER = "#ff6747";
const MUTED = "#606b78";
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type ScreenPoint = { x: number; y: number; scale: number };

function project(point: IntelligenceCorePoint, width: number, height: number): ScreenPoint {
  const scale = Math.min(width * 0.44, height * 0.78);
  const depth = 1 / (1 + point.z * 0.16);
  return {
    x: width / 2 + (point.x + point.z * 0.12) * scale * depth,
    y: height / 2 + (point.y + point.z * 0.08) * scale * depth,
    scale: depth,
  };
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, glow = 0) {
  if (glow > 0) {
    ctx.beginPath();
    ctx.arc(x, y, radius * 3.2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = glow * 0.12;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawIntelligenceCore(
  ctx: CanvasRenderingContext2D,
  model: IntelligenceCoreModel,
  progress: number,
  width: number,
  height: number,
  seconds = 0,
  ambient = false,
) {
  ctx.clearRect(0, 0, width, height);
  const points = sampleIntelligenceCore(model, progress);
  const byId = new Map(points.map((point) => [point.id, point]));
  const screen = new Map(points.map((point) => {
    const position = project(point, width, height);
    const drift = ambient && point.active ? Math.sin(seconds * 0.7 + point.x * 11) * 1.15 : 0;
    return [point.id, { ...position, y: position.y + drift }];
  }));
  const get = (id: string) => screen.get(id) ?? { x: width / 2, y: height / 2, scale: 1 };
  const path = (ids: string[], color: string, opacity: number, lineWidth = 1) => {
    ctx.beginPath();
    ids.forEach((id, index) => {
      const point = get(id);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = color;
    ctx.globalAlpha = opacity;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  const center = get("core");
  for (let ring = 0; ring < 4; ring++) {
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, width * (0.11 + ring * 0.048), height * (0.12 + ring * 0.055), -0.08, 0, Math.PI * 2);
    ctx.strokeStyle = ring === 0 ? "#3876a9" : "#25303a";
    ctx.globalAlpha = ring === 0 ? 0.16 : 0.3 - ring * 0.045;
    ctx.lineWidth = 1;
    ctx.setLineDash(ring % 2 ? [2, 7] : []);
    ctx.lineDashOffset = ambient ? -seconds * (ring % 2 ? 2 : 0.8) : 0;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  const routeIds = ["core", ...model.strategyStages.map(({ id }) => `stage:${id}`), "decision", "tape"];
  path(routeIds, "#667889", 0.36, Math.max(1, width / 900));

  for (const hook of model.hooks.filter(({ live, stage }) => live && stage !== "breaker")) {
    const point = byId.get(`hook:${hook.id}`);
    if (!point) continue;
    const from = get(`stage:${hook.stage}`);
    const to = get(`hook:${hook.id}`);
    const isSelected = hook.selected;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo((from.x + to.x) * 0.5, (from.y + to.y) * 0.5 - 4, to.x, to.y);
    ctx.strokeStyle = BLUE;
    ctx.globalAlpha = isSelected ? 0.12 : 0.045;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const breakerPoints = model.breakers.map(({ id }) => get(`hook:${id}`));
  if (breakerPoints.length > 2) {
    ctx.beginPath();
    breakerPoints.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
    ctx.closePath();
    ctx.strokeStyle = EMBER;
    ctx.globalAlpha = 0.16 + Math.max(0, Math.min(1, (progress - 0.48) * 2.2)) * 0.38;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 7]);
    ctx.lineDashOffset = ambient ? -seconds * 2 : 0;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  const coreRadius = Math.min(width, height) * (0.055 + (ambient ? Math.sin(seconds * 1.4) * 0.002 : 0));
  const coreGlow = ctx.createRadialGradient(center.x, center.y, 1, center.x, center.y, coreRadius * 2.5);
  coreGlow.addColorStop(0, "#b8e1ff");
  coreGlow.addColorStop(0.16, BLUE);
  coreGlow.addColorStop(0.46, "rgba(35,140,255,.32)");
  coreGlow.addColorStop(1, "rgba(35,140,255,0)");
  ctx.beginPath();
  ctx.arc(center.x, center.y, coreRadius * 2.5, 0, Math.PI * 2);
  ctx.fillStyle = coreGlow;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(center.x, center.y, coreRadius * 0.72, 0, Math.PI * 2);
  ctx.fillStyle = "#d8efff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(center.x, center.y, coreRadius * 0.43, 0, Math.PI * 2);
  ctx.fillStyle = BLUE;
  ctx.fill();

  const progressAlpha = (kind: string) => kind === "stage" ? 0.72 : kind === "hook" ? 0.9 : 1;
  for (const point of points) {
    if (point.kind === "core") continue;
    const position = get(point.id);
    const activeOpacity = progressAlpha(point.kind);
    if (point.kind === "hook") {
      const color = point.live ? (point.selected ? BLUE_LIGHT : BLUE) : MUTED;
      const radius = point.live ? (point.selected ? 3.3 : 2.6) : 1.65;
      dot(ctx, position.x, position.y, Math.max(1.2, radius * position.scale), color, point.live && point.selected ? 1 : 0);
      if (!point.live) {
        ctx.beginPath();
        ctx.arc(position.x, position.y, 3, 0, Math.PI * 2);
        ctx.strokeStyle = MUTED;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 0.6;
        ctx.setLineDash([1.4, 1.5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (point.kind === "breaker") {
      dot(ctx, position.x, position.y, 3.2 * position.scale, EMBER, progress > 0.5 ? 1 : 0.4);
    } else if (point.kind === "stage") {
      dot(ctx, position.x, position.y, 5.3 * position.scale, BLUE_LIGHT, 1);
      ctx.beginPath();
      ctx.arc(position.x, position.y, 9.2 * position.scale, 0, Math.PI * 2);
      ctx.strokeStyle = BLUE;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (point.kind === "decision") {
      dot(ctx, position.x, position.y, 5.5 * position.scale, BLUE_LIGHT, progress > 0.72 ? 1 : 0.35);
      ctx.beginPath();
      ctx.arc(position.x, position.y, 12 * position.scale, 0, Math.PI * 2);
      ctx.strokeStyle = BLUE;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (point.kind === "tape") {
      const w = Math.max(26, width * 0.055) * position.scale;
      const h = Math.max(20, height * 0.075) * position.scale;
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = "#101821";
      ctx.strokeStyle = "#678097";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(position.x - w / 2, position.y - h / 2, w, h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = BLUE_LIGHT;
      for (let line = 0; line < 3; line++) {
        ctx.beginPath();
        ctx.moveTo(position.x - w * 0.3, position.y - h * 0.2 + line * h * 0.2);
        ctx.lineTo(position.x + w * 0.3, position.y - h * 0.2 + line * h * 0.2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = activeOpacity;
  }
  ctx.globalAlpha = 1;

  const stageLabelsAlpha = Math.min(clamp((progress - 0.12) * 8, 0, 1), clamp((0.84 - progress) * 8, 0, 1));
  if (stageLabelsAlpha > 0) {
    ctx.font = `600 ${Math.max(7, Math.min(9, width * 0.008))}px ui-monospace, SFMono-Regular, monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#aeb9c4";
    ctx.globalAlpha = stageLabelsAlpha * 0.86;
    for (const stage of model.strategyStages) {
      const point = get(`stage:${stage.id}`);
      ctx.fillText(stage.label.toUpperCase(), point.x, point.y + 18 * point.scale);
    }
    ctx.globalAlpha = 1;
  }

  if (progress > 0.46 && progress < 0.84 && breakerPoints.length) {
    const top = Math.min(...breakerPoints.map(({ y }) => y));
    const centerX = breakerPoints.reduce((sum, point) => sum + point.x, 0) / breakerPoints.length;
    ctx.font = `600 ${Math.max(7, Math.min(9, width * 0.008))}px ui-monospace, SFMono-Regular, monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = EMBER;
    ctx.globalAlpha = Math.min(0.8, (progress - 0.46) * 5);
    ctx.fillText("BREAKER · 5 GUARDS", centerX, Math.max(18, top - 12));
    ctx.globalAlpha = 1;
  }

  const evidence = get("tape");
  if (progress > 0.72) {
    ctx.font = `600 ${Math.max(8, width * 0.011)}px ui-monospace, SFMono-Regular, monospace`;
    ctx.textAlign = "center";
    const decision = get("decision");
    ctx.fillStyle = BLUE_LIGHT;
    ctx.globalAlpha = Math.min(0.78, (progress - 0.72) * 3.2);
    ctx.font = `600 ${Math.max(7, Math.min(9, width * 0.008))}px ui-monospace, SFMono-Regular, monospace`;
    ctx.fillText("PAPER DECISION", decision.x, decision.y + 20);
    ctx.fillStyle = EMBER;
    ctx.globalAlpha = Math.min(0.85, (progress - 0.72) * 3.2);
    ctx.fillText("ILLUSTRATIVE · NO RECORDED TRADE", evidence.x, evidence.y + Math.max(22, height * 0.08));
    ctx.globalAlpha = 1;
  }
}

export function drawStaticIntelligenceCore(ctx: CanvasRenderingContext2D, model: IntelligenceCoreModel, progress: number, width: number, height: number) {
  drawIntelligenceCore(ctx, model, progress, width, height, 0, false);
}
