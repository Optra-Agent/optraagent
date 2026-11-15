import type { ForgeDemoData } from "./section-data";

export type CoreVector = { x: number; y: number; z: number };
export type CoreKeyframeName = "core" | "strategy" | "hooks" | "risk" | "evidence";
export type CorePointKind = "core" | "stage" | "hook" | "breaker" | "decision" | "tape";

export type IntelligenceCorePoint = CoreVector & {
  id: string;
  label: string;
  kind: CorePointKind;
  stage: string | null;
  live: boolean;
  selected: boolean;
  active: boolean;
};

export type IntelligenceCoreModel = {
  strategyStages: { id: string; label: string }[];
  hooks: { id: string; label: string; stage: string; live: boolean; selected: boolean }[];
  breakers: { id: string; label: string }[];
  keyframes: { name: CoreKeyframeName; points: IntelligenceCorePoint[] }[];
};

const FRAME_NAMES: CoreKeyframeName[] = ["core", "strategy", "hooks", "risk", "evidence"];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 10_000) / 10_000;

function basePoints(data: ForgeDemoData): Omit<IntelligenceCorePoint, keyof CoreVector>[] {
  const strategyStages = data.stages.filter(({ stage }) => stage !== "breaker");
  const hooks = data.stages.flatMap(({ stage, hooks: stageHooks }) => stageHooks.map((hook) => ({
    id: `hook:${hook.id}`,
    label: hook.name,
    kind: stage === "breaker" ? "breaker" as const : "hook" as const,
    stage,
    live: hook.live,
    selected: data.required.includes(hook.id),
    active: stage !== "breaker" && hook.live,
  })));
  return [
    { id: "core", label: "Protective Put", kind: "core", stage: null, live: true, selected: true, active: true },
    ...strategyStages.map(({ stage, label }) => ({ id: `stage:${stage}`, label, kind: "stage" as const, stage, live: true, selected: true, active: true })),
    ...hooks,
    { id: "decision", label: "Paper decision", kind: "decision", stage: null, live: true, selected: false, active: true },
    { id: "tape", label: "Tape representation", kind: "tape", stage: null, live: true, selected: false, active: true },
  ];
}

function positionsForFrame(data: ForgeDemoData, name: CoreKeyframeName): Map<string, CoreVector> {
  const stages = data.stages.filter(({ stage }) => stage !== "breaker");
  const result = new Map<string, CoreVector>();
  const put = (id: string, x: number, y: number, z = 0) => result.set(id, { x, y, z });
  const stageX = (index: number) => -0.68 + index * 0.34;
  const hookOffsets = (index: number, live: boolean) => {
    const angle = index * 2.399963229728653;
    const radius = (live ? 0.22 : 0.34) + (index % 3) * 0.025;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.78, z: ((index % 5) - 2) * 0.13 };
  };

  if (name === "core") {
    put("core", 0, 0, 0.1);
    stages.forEach(({ stage }, index) => {
      const angle = -Math.PI / 2 + (index / stages.length) * Math.PI * 2;
      put(`stage:${stage}`, Math.cos(angle) * 0.35, Math.sin(angle) * 0.26, Math.sin(angle * 2) * 0.25);
    });
    data.stages.forEach(({ stage, hooks }) => hooks.forEach((hook, index) => {
      const offset = hookOffsets(index + (stage === "breaker" ? 8 : 0), hook.live);
      const anchor = stage === "breaker" ? 0.63 : 0.12;
      const angle = (index / Math.max(1, hooks.length)) * Math.PI * 2;
      put(`hook:${hook.id}`, Math.cos(angle) * anchor + offset.x * 0.6, Math.sin(angle) * anchor * 0.7 + offset.y * 0.6, offset.z);
    }));
    put("decision", 0.1, 0.02, -0.2);
    put("tape", 0.3, -0.06, -0.28);
    return result;
  }

  if (name === "strategy") {
    put("core", -0.91, 0, 0.06);
    stages.forEach(({ stage }, index) => put(`stage:${stage}`, stageX(index), Math.sin(index * 0.85) * 0.04, Math.cos(index * 0.9) * 0.16));
    data.stages.forEach(({ stage, hooks }) => hooks.forEach((hook, index) => {
      if (stage === "breaker") {
        const angle = (index / hooks.length) * Math.PI * 2;
        put(`hook:${hook.id}`, Math.cos(angle) * 0.9, Math.sin(angle) * 0.54, Math.sin(angle) * 0.2);
      } else {
        const anchor = stageX(stages.findIndex((entry) => entry.stage === stage));
        const offset = hookOffsets(index, hook.live);
        put(`hook:${hook.id}`, anchor + offset.x, offset.y + offset.z * 0.12, offset.z);
      }
    }));
    put("decision", 0.87, -0.05, -0.08);
    put("tape", 1.02, 0.1, -0.13);
    return result;
  }

  if (name === "hooks") {
    put("core", -0.94, 0, 0.1);
    stages.forEach(({ stage }, index) => put(`stage:${stage}`, stageX(index) * 0.88, 0, Math.sin(index) * 0.08));
    data.stages.forEach(({ stage, hooks }) => {
      const stageIndex = stages.findIndex((entry) => entry.stage === stage);
      hooks.forEach((hook, index) => {
        const angle = (index / Math.max(1, hooks.length)) * Math.PI * 2 - Math.PI / 2;
        const radius = stage === "breaker" ? 0.17 : hook.live ? 0.23 : 0.37;
        const centerX = stage === "breaker" ? 0.8 : stageX(stageIndex);
        const centerY = stage === "breaker" ? -0.34 : 0;
        put(`hook:${hook.id}`, centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius * 0.62, ((index % 4) - 1.5) * 0.12);
      });
    });
    put("decision", 0.91, -0.08, -0.06);
    put("tape", 1.05, 0.08, -0.1);
    return result;
  }

  if (name === "risk") {
    put("core", -0.9, 0, 0.08);
    stages.forEach(({ stage }, index) => put(`stage:${stage}`, stageX(index) * 0.92, Math.sin(index * 1.15) * 0.09, 0.05));
    data.stages.forEach(({ stage, hooks }) => hooks.forEach((hook, index) => {
      if (stage === "breaker") {
        const angle = -Math.PI / 2 + (index / hooks.length) * Math.PI * 2;
        put(`hook:${hook.id}`, Math.cos(angle) * 0.86, Math.sin(angle) * 0.53, Math.sin(angle * 2) * 0.16);
      } else {
        const anchor = stageX(stages.findIndex((entry) => entry.stage === stage));
        const offset = hookOffsets(index + 2, hook.live);
        put(`hook:${hook.id}`, anchor + offset.x * 0.55, offset.y * 0.55, offset.z * 0.5);
      }
    }));
    put("decision", 0.86, 0, 0.12);
    put("tape", 1.03, -0.1, -0.08);
    return result;
  }

  put("core", -0.94, 0, -0.12);
  stages.forEach(({ stage }, index) => put(`stage:${stage}`, -0.5 + index * 0.14, Math.sin(index * 0.78) * 0.12, -0.04 + index * 0.04));
  data.stages.forEach(({ stage, hooks }) => hooks.forEach((hook, index) => {
    if (stage === "breaker") {
      const angle = (index / hooks.length) * Math.PI * 2;
      put(`hook:${hook.id}`, Math.cos(angle) * 0.63, Math.sin(angle) * 0.42, -0.15);
    } else {
      const anchor = -0.5 + stages.findIndex((entry) => entry.stage === stage) * 0.14;
      const offset = hookOffsets(index, hook.live);
      put(`hook:${hook.id}`, anchor + 0.14 + offset.x * 0.36, offset.y * 0.4, -0.08 + offset.z * 0.2);
    }
  }));
  put("decision", 0.38, 0, 0.08);
  put("tape", 0.76, 0, 0.06);
  return result;
}

export function buildIntelligenceCoreModel(data: ForgeDemoData): IntelligenceCoreModel {
  const base = basePoints(data);
  const keyframes = FRAME_NAMES.map((name) => {
    const positions = positionsForFrame(data, name);
    return {
      name,
      points: base.map((point) => ({ ...point, ...(positions.get(point.id) ?? { x: 0, y: 0, z: 0 }) })) as IntelligenceCorePoint[],
    };
  });
  const breakers = data.stages.find(({ stage }) => stage === "breaker")?.hooks.map(({ id, name }) => ({ id, label: name })) ?? [];
  return {
    strategyStages: data.stages.filter(({ stage }) => stage !== "breaker").map(({ stage, label }) => ({ id: stage, label })),
    hooks: data.stages.flatMap(({ stage, hooks }) => hooks.map(({ id, name, live }) => ({ id, label: name, stage, live, selected: data.required.includes(id) }))),
    breakers,
    keyframes,
  };
}

export function sampleIntelligenceCore(model: IntelligenceCoreModel, progress: number): IntelligenceCorePoint[] {
  const normalized = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  const value = clamp(normalized * model.keyframes.length - 0.5, 0, model.keyframes.length - 1);
  const index = Math.min(model.keyframes.length - 2, Math.floor(value));
  const local = value >= model.keyframes.length - 1 ? 1 : value - index;
  const from = model.keyframes[index]?.points ?? [];
  const to = model.keyframes[index + 1]?.points ?? from;
  return from.map((point, pointIndex) => {
    const target = to[pointIndex] ?? point;
    return {
      ...point,
      x: round(point.x + (target.x - point.x) * local),
      y: round(point.y + (target.y - point.y) * local),
      z: round(point.z + (target.z - point.z) * local),
    };
  });
}
