import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { COLUMNS, ENTRY, floorColumns, type FloorParams } from "./payoff";

/**
 * The Protective Floor, as a physical object. Two rows of columns stand on one slab, one per possible price at expiry.
 * Back row: the holding on its own, so its value falls with the price. Front row: the same holding with a long put.
 * Azure is what the holding keeps, vermilion is what the put supplies (the floor filling in), and the clear caps are the premium paid.
 * The heights come from payoff.ts and nothing else. No price, return or trade is invented here.
 */

export type FloorView = "overview" | "floor" | "cost";
export type LabelKey = "floor" | "entry" | "with" | "without" | "axis" | "cost";
export type Anchor = { cx: number; cy: number; fit: number };

export type FloorScene = {
  setParams: (params: FloorParams) => void;
  setView: (view: FloorView) => void;
  setAnchor: (anchor: Anchor | null, immediate?: boolean) => void;
  setExplode: (value: number) => void;
  setPointer: (x: number, y: number) => void;
  setYaw: (radians: number) => void;
  setActive: (on: boolean) => void;
  playIntro: () => void;
  bindLabels: (labels: Partial<Record<LabelKey, HTMLElement>>) => void;
  onContextLost: (callback: () => void) => void;
  renderOnce: () => void;
  dispose: () => void;
};

type Options = { reduced: boolean; lowPower: boolean; coarse: boolean; params: FloorParams };

const K = 0.055; // world units per price point
const SPACING = 0.92;
const WIDTH = 0.74;
const DEPTH = 2.2;
const FRONT_Z = 1.9;
const BACK_Z = -3.6;
const HALF = ((COLUMNS - 1) * SPACING) / 2;

const VIEWS: Record<FloorView, { pos: [number, number, number]; look: [number, number, number] }> = {
  overview: { pos: [-10.5, 12.8, 17.5], look: [0.6, 2.5, -0.8] },
  floor: { pos: [-13.5, 5.2, 11.5], look: [1.5, 4, 0.4] },
  cost: { pos: [12.5, 10.5, 12.5], look: [5.5, 4.8, 0] },
};

const CORNERS: [number, number, number][] = [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]];
const EDGES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

type Part = "holding" | "kept" | "put" | "cost";
type ColumnGroup = { part: Part; mesh: InstancedMesh; z: number; edge: [number, number, number]; from: Vector3[]; fromQuat: Quaternion[]; delay: number[]; burst: Vector3[]; burstQuat: Quaternion[] };

function rng(seed: number) {
  let state = (seed * 2654435761) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4);
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export function createFloorScene(canvas: HTMLCanvasElement, options: Options): FloorScene {
  const renderer = new WebGLRenderer({ canvas, antialias: !options.lowPower, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const maxRatio = options.lowPower || options.coarse ? 1.25 : 1.75;
  let ratio = Math.min(window.devicePixelRatio || 1, maxRatio);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 120);
  const world = new Group(); // a pivot for slow drift and drag
  scene.add(world);

  scene.add(new HemisphereLight(0x9db4d6, 0x0b0c0e, 0.9));
  const key = new DirectionalLight(0xffffff, 2.6);
  key.position.set(-7, 15, 11);
  scene.add(key);
  const rim = new DirectionalLight(0x4aa8ff, 1.5);
  rim.position.set(12, 7, -9);
  scene.add(rim);
  const glow = new PointLight(0xff5a1f, 26, 16, 2);
  scene.add(glow);

  // Slab
  const slab = new Mesh(new BoxGeometry(HALF * 2 + 2.6, 0.24, 10.2), new MeshStandardMaterial({ color: 0x14171c, roughness: 0.7, metalness: 0.2 }));
  slab.position.set(0, -0.14, -0.4);
  world.add(slab);

  // Columns
  const unit = new BoxGeometry(1, 1, 1);
  // Each column is darker at its foot and lighter at its top, so the object reads as lit from above rather than flat.
  const shade = new Float32Array(unit.attributes.position.count * 3);
  for (let v = 0; v < unit.attributes.position.count; v += 1) {
    const level = 0.5 + 0.5 * (unit.attributes.position.getY(v) + 0.5);
    shade[v * 3] = shade[v * 3 + 1] = shade[v * 3 + 2] = level;
  }
  unit.setAttribute("color", new BufferAttribute(shade, 3));
  const materials: Record<Part, MeshStandardMaterial> = {
    holding: new MeshStandardMaterial({ color: 0x3a414c, roughness: 0.6, metalness: 0.1, vertexColors: true }),
    kept: new MeshStandardMaterial({ color: 0x2f86f0, roughness: 0.42, metalness: 0.05, emissive: 0x0a2c5c, emissiveIntensity: 0.5, vertexColors: true }),
    put: new MeshStandardMaterial({ color: 0xea5a38, roughness: 0.45, metalness: 0.05, emissive: 0x7a2210, emissiveIntensity: 0.6, vertexColors: true }),
    cost: new MeshStandardMaterial({ color: 0xff7a55, roughness: 0.3, transparent: true, opacity: 0.16, depthWrite: false }),
  };
  const defs: { part: Part; z: number; edge: [number, number, number]; delay: number }[] = [
    { part: "holding", z: BACK_Z, edge: [0.34, 0.38, 0.46], delay: 0.18 },
    { part: "kept", z: FRONT_Z, edge: [0.5, 0.78, 1], delay: 0 },
    { part: "put", z: FRONT_Z, edge: [1, 0.5, 0.36], delay: 0.1 },
    { part: "cost", z: FRONT_Z, edge: [0.95, 0.42, 0.28], delay: 0.22 },
  ];
  const groups: ColumnGroup[] = defs.map((def, groupIndex) => {
    const mesh = new InstancedMesh(unit, materials[def.part], COLUMNS);
    mesh.frustumCulled = false;
    mesh.visible = false;
    world.add(mesh);
    const next = rng(31 + groupIndex * 7);
    const from: Vector3[] = [];
    const fromQuat: Quaternion[] = [];
    const delay: number[] = [];
    const burst: Vector3[] = [];
    const burstQuat: Quaternion[] = [];
    for (let i = 0; i < COLUMNS; i += 1) {
      const angle = next() * Math.PI * 2;
      const radius = 5 + next() * 8;
      from.push(new Vector3(Math.cos(angle) * radius, 2 + next() * 9, Math.sin(angle) * radius * 0.7 + 3));
      fromQuat.push(new Quaternion().setFromEuler(new Euler(next() * 6, next() * 6, next() * 6)));
      delay.push(def.delay + (i / (COLUMNS - 1)) * 0.5 + next() * 0.3);
      burst.push(new Vector3((next() - 0.5) * 1.6, 0.8 + next() * 3.2, (next() - 0.5) * 6));
      burstQuat.push(new Quaternion().setFromEuler(new Euler((next() - 0.5) * 0.9, (next() - 0.5) * 0.9, (next() - 0.5) * 0.9)));
    }
    return { part: def.part, mesh, z: def.z, edge: def.edge, from, fromQuat, delay, burst, burstQuat };
  });

  // One merged line mesh draws a crisp edge on every column.
  const edgeVerts = groups.length * COLUMNS * EDGES.length * 2;
  const edgeGeometry = new BufferGeometry();
  const edgePositions = new Float32Array(edgeVerts * 3);
  const edgeColors = new Float32Array(edgeVerts * 3);
  edgeGeometry.setAttribute("position", new BufferAttribute(edgePositions, 3));
  edgeGeometry.setAttribute("color", new BufferAttribute(edgeColors, 3));
  const edges = new LineSegments(edgeGeometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
  edges.frustumCulled = false;
  edges.visible = false;
  world.add(edges);

  // Floor sheet: a thin vermilion plane at the lowest net value, across the front row.
  const sheetMaterial = new MeshStandardMaterial({ color: 0xe8492a, roughness: 0.3, transparent: true, opacity: 0.26, emissive: 0xff5a1f, emissiveIntensity: 0.55, depthWrite: false });
  const sheet = new Mesh(unit, sheetMaterial);
  sheet.visible = false;
  world.add(sheet);
  const sheetEdge = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xff7a55, transparent: true, opacity: 0.95 }));
  const sheetEdgePositions = new Float32Array(EDGES.length * 2 * 3);
  sheetEdge.geometry.setAttribute("position", new BufferAttribute(sheetEdgePositions, 3));
  sheetEdge.frustumCulled = false;
  sheetEdge.visible = false;
  world.add(sheetEdge);

  // Entry marker: a hairline at the entry value across the back row.
  const entryGeometry = new BufferGeometry();
  const entryY = ENTRY * K;
  entryGeometry.setAttribute("position", new BufferAttribute(new Float32Array([-HALF - 0.9, entryY, BACK_Z, HALF + 0.9, entryY, BACK_Z]), 3));
  const entryLine = new LineSegments(entryGeometry, new LineBasicMaterial({ color: 0xa1a6b0, transparent: true, opacity: 0.55 }));
  entryLine.visible = false;
  world.add(entryLine);

  // State
  let params = options.params;
  let target = floorColumns(params);
  const current: Record<Part, number[]> = {
    holding: target.map((c) => c.holding),
    kept: target.map((c) => c.kept),
    put: target.map((c) => c.put),
    cost: target.map((c) => c.cost),
  };
  let floorY = (params.strike - params.premium) * K;
  const view = { name: "overview" as FloorView, pos: new Vector3(...VIEWS.overview.pos), look: new Vector3(...VIEWS.overview.look) };
  const camPos = view.pos.clone();
  const camLook = view.look.clone();
  const anchorNow = { cx: 0, cy: 0, fit: 1 };
  let anchorTarget: Anchor | null = null;
  let anchorSet = false;
  let explodeTarget = 0;
  let explode = 0;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let yawTarget = 0;
  let yaw = 0;
  let introStart: number | null = null;
  let introDone = false;
  let active = false;
  let frame = 0;
  let last = 0;
  let dirty = true;
  let labelEls: Partial<Record<LabelKey, HTMLElement>> = {};
  let lostCallback: (() => void) | null = null;
  let slow = 0;
  let sized = { w: 0, h: 0, r: 0 };

  const m = new Matrix4();
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();
  const identity = new Quaternion();
  const corner = new Vector3();
  const colorTmp = new Color();
  const labelPoint = new Vector3();

  function placeLabels(w: number, h: number, visible: number) {
    const points: Record<LabelKey, [number, number, number]> = {
      floor: [-HALF - 0.9, floorY, FRONT_Z + DEPTH / 2],
      entry: [-HALF - 0.9, entryY, BACK_Z],
      with: [-HALF - 0.2, 0, FRONT_Z + DEPTH / 2 + 0.7],
      without: [HALF - 2.2, current.holding[COLUMNS - 1] * K + 1.1, BACK_Z],
      axis: [0, -0.3, FRONT_Z + DEPTH / 2 + 1.7],
      cost: [HALF - 0.9, (current.kept[COLUMNS - 1] + current.put[COLUMNS - 1]) * K + 1, FRONT_Z],
    };
    for (const key of Object.keys(labelEls) as LabelKey[]) {
      const el = labelEls[key];
      if (!el) continue;
      labelPoint.set(...points[key]);
      world.localToWorld(labelPoint);
      labelPoint.project(camera);
      const x = (labelPoint.x * 0.5 + 0.5) * w;
      const y = (-labelPoint.y * 0.5 + 0.5) * h;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.opacity = String(visible);
    }
  }

  function writeBox(group: ColumnGroup, index: number, slot: number, y0: number, height: number, x: number, introE: number, e: number) {
    // A part with no height collapses to a point, so it draws neither a plate nor an edge on top of its neighbour.
    const collapsed = height < 0.05;
    const sy = collapsed ? 0 : height * K;
    const sx = WIDTH;
    const sz = DEPTH;
    const centre = pos.set(x, y0 * K + sy / 2, group.z);
    // The burst (scroll explode) and the intro share one blend so a column always has one well-defined pose.
    const lift = group.burst[index];
    centre.x += lift.x * e;
    centre.y += lift.y * e;
    centre.z += lift.z * e;
    const rise = 1 - introE;
    if (rise > 0) centre.lerp(group.from[index], rise);
    quat.copy(identity).slerp(group.burstQuat[index], e);
    if (rise > 0) quat.slerp(group.fromQuat[index], rise);
    const s = collapsed ? 0 : 0.35 + 0.65 * introE;
    scl.set(sx * s, sy * (0.35 + 0.65 * introE), sz * s);
    m.compose(centre, quat, scl);
    group.mesh.setMatrixAt(index, m);
    // Edges for this column.
    const base = (slot * COLUMNS + index) * EDGES.length * 2;
    for (let edge = 0; edge < EDGES.length; edge += 1) {
      for (let end = 0; end < 2; end += 1) {
        const c = CORNERS[EDGES[edge][end]];
        corner.set(c[0], c[1], c[2]).applyMatrix4(m);
        const vi = (base + edge * 2 + end) * 3;
        edgePositions[vi] = corner.x;
        edgePositions[vi + 1] = corner.y;
        edgePositions[vi + 2] = corner.z;
        colorTmp.setRGB(group.edge[0], group.edge[1], group.edge[2]);
        edgeColors[vi] = colorTmp.r;
        edgeColors[vi + 1] = colorTmp.g;
        edgeColors[vi + 2] = colorTmp.b;
      }
    }
  }

  function updateColumns(now: number, dt: number): boolean {
    let moving = false;
    const rate = options.reduced ? 60 : 9;
    for (let i = 0; i < COLUMNS; i += 1) {
      const t = target[i];
      const goal: Record<Part, number> = { holding: t.holding, kept: t.kept, put: t.put, cost: t.cost };
      (Object.keys(goal) as Part[]).forEach((part) => {
        const delta = goal[part] - current[part][i];
        if (Math.abs(delta) > 0.01) {
          current[part][i] += delta * damp(rate, dt);
          moving = true;
        } else current[part][i] = goal[part];
      });
    }
    const elapsed = introStart === null ? 0 : (now - introStart) / 1000;
    let introMin = 1;
    groups.forEach((group, slot) => {
      for (let i = 0; i < COLUMNS; i += 1) {
        const x = (i - (COLUMNS - 1) / 2) * SPACING;
        const introE = options.reduced || introDone ? 1 : introStart === null ? 0 : easeOut((elapsed - group.delay[i]) / 1.15);
        introMin = Math.min(introMin, introE);
        let y0 = 0;
        let height = current[group.part][i];
        if (group.part === "put") y0 = current.kept[i];
        if (group.part === "cost") {
          y0 = current.kept[i] + current.put[i];
          height = current.cost[i];
        }
        writeBox(group, i, slot, y0, height, x, introE, explode);
      }
      group.mesh.instanceMatrix.needsUpdate = true;
    });
    edgeGeometry.attributes.position.needsUpdate = true;
    edgeGeometry.attributes.color.needsUpdate = true;
    if (introStart !== null && introMin >= 1) introDone = true;
    return moving || (introStart !== null && !introDone);
  }

  function updateSheet() {
    floorY = (params.strike - params.premium) * K;
    sheet.position.set(0, floorY, FRONT_Z);
    sheet.scale.set(HALF * 2 + 1.5, 0.05, DEPTH + 0.8);
    sheetEdge.position.copy(sheet.position);
    for (let edge = 0; edge < EDGES.length; edge += 1) {
      for (let end = 0; end < 2; end += 1) {
        const c = CORNERS[EDGES[edge][end]];
        const vi = (edge * 2 + end) * 3;
        sheetEdgePositions[vi] = c[0] * sheet.scale.x;
        sheetEdgePositions[vi + 1] = c[1] * sheet.scale.y;
        sheetEdgePositions[vi + 2] = c[2] * sheet.scale.z;
      }
    }
    sheetEdge.geometry.attributes.position.needsUpdate = true;
    glow.position.set(-HALF + 2, floorY + 1.2, FRONT_Z + 2.4);
  }

  function resize(force = false) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!force && w === sized.w && h === sized.h && ratio === sized.r) return;
    if (!w || !h) return;
    sized = { w, h, r: ratio };
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    dirty = true;
  }

  function render(now: number) {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    resize();
    if (!sized.w) return;

    // Camera: damped toward the chosen view, with a little pointer parallax and a limited drag.
    const k = options.reduced ? 1 : damp(3.2, dt);
    view.pos.set(...VIEWS[view.name].pos);
    view.look.set(...VIEWS[view.name].look);
    camPos.lerp(view.pos, k);
    camLook.lerp(view.look, k);
    pointer.sx += (pointer.x - pointer.sx) * damp(4, dt);
    pointer.sy += (pointer.y - pointer.sy) * damp(4, dt);
    yaw += (yawTarget - yaw) * damp(6, dt);
    explode += (explodeTarget - explode) * damp(options.reduced ? 60 : 4.5, dt);
    const drift = options.reduced ? 0 : Math.sin(now / 5200) * 0.025;
    world.rotation.y = yaw + pointer.sx * 0.06 + drift;
    camera.position.copy(camPos);
    camera.position.y += pointer.sy * -0.5;
    camera.lookAt(camLook);

    // Anchor the object to its slot in the page.
    if (anchorTarget) {
      const a = anchorSet && !options.reduced ? damp(8, dt) : 1;
      anchorNow.cx += (anchorTarget.cx - anchorNow.cx) * a;
      anchorNow.cy += (anchorTarget.cy - anchorNow.cy) * a;
      anchorNow.fit += (anchorTarget.fit - anchorNow.fit) * a;
      anchorSet = true;
    }
    const dx = anchorTarget ? anchorNow.cx - sized.w / 2 : 0;
    const dy = anchorTarget ? anchorNow.cy - sized.h / 2 : 0;
    camera.setViewOffset(sized.w, sized.h, -dx, -dy, sized.w, sized.h);
    camera.zoom = anchorTarget ? anchorNow.fit : 1;
    camera.updateProjectionMatrix();

    const moving = updateColumns(now, dt);
    if (moving) dirty = true;
    const visibleLabels = introStart === null && !options.reduced ? 0 : introDone || options.reduced ? 1 : 0;
    if (options.reduced && !dirty) return;
    renderer.render(scene, camera);
    placeLabels(sized.w, sized.h, visibleLabels * (1 - Math.min(1, explode * 1.6)));
    dirty = false;

    // Safeguard: if frames stay slow, step the resolution down rather than stutter.
    if (!options.reduced) {
      slow = dt > 0.034 ? slow + 1 : Math.max(0, slow - 1);
      if (slow > 70 && ratio > 0.8) {
        ratio = Math.max(0.8, ratio - 0.25);
        slow = 0;
      }
    }
  }

  function loop(now: number) {
    frame = 0;
    if (!active) return;
    render(now);
    frame = requestAnimationFrame(loop);
  }

  function start() {
    if (frame || !active) return;
    last = 0;
    frame = requestAnimationFrame(loop);
  }

  const onLost = (event: Event) => {
    event.preventDefault();
    lostCallback?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  updateSheet();
  if (options.reduced) {
    // Assembled and still, drawn on demand.
    groups.forEach((group) => { group.mesh.visible = true; });
    edges.visible = sheet.visible = sheetEdge.visible = entryLine.visible = true;
    introDone = true;
    introStart = 0;
  }

  return {
    setParams(next) {
      params = next;
      target = floorColumns(next);
      updateSheet();
      dirty = true;
    },
    setView(next) {
      view.name = next;
      dirty = true;
    },
    setAnchor(next, immediate) {
      anchorTarget = next;
      if (next && (immediate || !anchorSet)) {
        anchorNow.cx = next.cx;
        anchorNow.cy = next.cy;
        anchorNow.fit = next.fit;
        anchorSet = true;
      }
      dirty = true;
    },
    setExplode(value) {
      explodeTarget = Math.min(1, Math.max(0, value));
      dirty = true;
    },
    setPointer(x, y) {
      pointer.x = x;
      pointer.y = y;
    },
    setYaw(radians) {
      yawTarget = Math.max(-0.5, Math.min(0.5, radians));
      dirty = true;
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        dirty = true;
        start();
      } else if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    },
    playIntro() {
      if (options.reduced) {
        dirty = true;
        return;
      }
      groups.forEach((group) => { group.mesh.visible = true; });
      edges.visible = sheet.visible = sheetEdge.visible = entryLine.visible = true;
      introStart = performance.now();
      dirty = true;
    },
    bindLabels(next) {
      labelEls = next;
    },
    onContextLost(callback) {
      lostCallback = callback;
    },
    renderOnce() {
      dirty = true;
      if (!active) render(performance.now());
    },
    dispose() {
      active = false;
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener("webglcontextlost", onLost);
      unit.dispose();
      slab.geometry.dispose();
      (slab.material as MeshStandardMaterial).dispose();
      Object.values(materials).forEach((material) => material.dispose());
      groups.forEach((group) => group.mesh.dispose());
      edgeGeometry.dispose();
      (edges.material as LineBasicMaterial).dispose();
      sheetMaterial.dispose();
      sheetEdge.geometry.dispose();
      (sheetEdge.material as LineBasicMaterial).dispose();
      entryGeometry.dispose();
      (entryLine.material as LineBasicMaterial).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
