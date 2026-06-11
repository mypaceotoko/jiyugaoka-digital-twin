import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CityData, Pt, Rail, Road } from "./types";

/**
 * Ambient simulation layer: pedestrians, cars and trains moving along the
 * OSM-derived network. All rendering is instanced (few draw calls), motion
 * is simple back-and-forth along polylines.
 */

interface PathAgent {
  path: Pt[];
  cum: number[]; // cumulative length per vertex
  total: number;
  s: number; // current distance along path
  dir: 1 | -1;
  speed: number;
  offset: number; // lateral offset (m)
  y: number;
  phase: number;
}

function cumulate(p: Pt[]): { cum: number[]; total: number } {
  const cum = [0];
  for (let i = 1; i < p.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  }
  return { cum, total: cum[cum.length - 1] };
}

/** Position + heading at distance s along the polyline. */
function sample(a: PathAgent, out: { x: number; z: number; hx: number; hz: number }): void {
  const { path, cum } = a;
  const s = Math.min(Math.max(a.s, 0), a.total);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const segLen = cum[i] - cum[i - 1] || 1;
  const f = (s - cum[i - 1]) / segLen;
  const [x0, z0] = path[i - 1];
  const [x1, z1] = path[i];
  const hx = (x1 - x0) / segLen;
  const hz = (z1 - z0) / segLen;
  out.x = x0 + (x1 - x0) * f - hz * a.offset;
  out.z = z0 + (z1 - z0) * f + hx * a.offset;
  out.hx = hx * a.dir;
  out.hz = hz * a.dir;
}

function step(a: PathAgent, dt: number): void {
  a.s += a.speed * a.dir * dt;
  if (a.s >= a.total) {
    a.s = a.total;
    a.dir = -1;
  } else if (a.s <= 0) {
    a.s = 0;
    a.dir = 1;
  }
}

function makeAgents(
  roads: { p: Pt[]; w: number; y: number }[],
  count: number,
  speedRange: [number, number],
  lateralFactor: number,
): PathAgent[] {
  const agents: PathAgent[] = [];
  if (!roads.length) return agents;
  // weight road choice by length so long streets get more agents
  const lens = roads.map((r) => cumulate(r.p).total);
  const totalLen = lens.reduce((s, l) => s + l, 0);
  for (let i = 0; i < count; i++) {
    let pick = Math.random() * totalLen;
    let ri = 0;
    while (ri < roads.length - 1 && pick > lens[ri]) {
      pick -= lens[ri];
      ri++;
    }
    const r = roads[ri];
    const { cum, total } = cumulate(r.p);
    if (total < 20) continue;
    agents.push({
      path: r.p,
      cum,
      total,
      s: Math.random() * total,
      dir: Math.random() < 0.5 ? 1 : -1,
      speed: speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]),
      offset: (Math.random() - 0.5) * r.w * lateralFactor,
      y: r.y,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return agents;
}

const WALK_ROADS = new Set(["pedestrian", "footway", "path", "living_street", "residential", "steps"]);
const DRIVE_ROADS = new Set(["primary", "secondary", "tertiary", "residential", "unclassified"]);
const BUS_ROADS = new Set(["primary", "secondary", "tertiary"]); // bus routes stick to main streets

const CLOTHES = [0x3a4a6b, 0x6b3a3a, 0x46663d, 0x55505e, 0x8a7f6a, 0xb0b4bb, 0x2e2e34, 0x7a5c47];
const CAR_COLORS = [0xd8d8da, 0x2b2b30, 0x9aa0a8, 0x5d6b7a, 0x8c3030, 0x3d5a4f, 0xcfc8b8];

export interface AgentSnapshot {
  x: number;
  y: number;
  z: number;
  id: string;
}

export class Simulation {
  readonly group = new THREE.Group();
  /** world positions updated every frame — consumed by the monitor overlay */
  readonly walkerSnapshots: AgentSnapshot[] = [];
  readonly carSnapshots: AgentSnapshot[] = [];
  readonly busSnapshots: AgentSnapshot[] = [];
  readonly trainSnapshots: AgentSnapshot[] = [];
  private walkers: PathAgent[] = [];
  private cars: PathAgent[] = [];
  private buses: PathAgent[] = [];
  private trains: { agent: PathAgent; carCount: number; spacing: number }[] = [];
  private walkerBody!: THREE.InstancedMesh;
  private walkerHead!: THREE.InstancedMesh;
  private carBody!: THREE.InstancedMesh;
  private carCabin!: THREE.InstancedMesh;
  private carWheels!: THREE.InstancedMesh;
  private busWheels!: THREE.InstancedMesh;
  private busBody!: THREE.InstancedMesh;
  private busWindows!: THREE.InstancedMesh;
  private trainCars!: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private sampled = { x: 0, z: 0, hx: 0, hz: 1 };

  constructor(data: CityData) {
    this.group.name = "simulation";
    this.initWalkers(data.roads);
    this.initCars(data.roads);
    this.initBuses(data.roads);
    this.initTrains(data.rails);
  }

  private initWalkers(roads: Road[]): void {
    const walkable = roads
      .filter((r) => WALK_ROADS.has(r.t) && (!r.ly || r.ly <= 0))
      .map((r) => ({ p: r.p, w: Math.max(r.w - 1, 1.2), y: 0.1 }));
    this.walkers = makeAgents(walkable, 130, [0.7, 1.6], 0.8);
    const n = this.walkers.length;
    if (!n) return;

    // torso + two legs in one instanced geometry (tinted per person)
    const torso = new THREE.CapsuleGeometry(0.21, 0.5, 2, 7);
    torso.translate(0, 1.02, 0);
    const legL = new THREE.CylinderGeometry(0.075, 0.065, 0.72, 5);
    legL.translate(0.105, 0.36, 0);
    const legR = legL.clone();
    legR.translate(-0.21, 0, 0);
    const bodyGeo = mergeGeometries([torso, legL, legR], false)!;
    this.walkerBody = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    const headGeo = new THREE.SphereGeometry(0.15, 6, 5);
    headGeo.translate(0, 1.52, 0);
    this.walkerHead = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial({ color: 0xe8c39e }), n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.setHex(CLOTHES[Math.floor(Math.random() * CLOTHES.length)]);
      c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
      this.walkerBody.setColorAt(i, c);
    }
    this.walkerBody.castShadow = true;
    this.walkerBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.walkerHead.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.walkerBody, this.walkerHead);
    for (let i = 0; i < n; i++) {
      this.walkerSnapshots.push({ x: 0, y: 0, z: 0, id: `PED-${String(i + 1).padStart(3, "0")}` });
    }
  }

  private initCars(roads: Road[]): void {
    const drivable = roads
      .filter((r) => DRIVE_ROADS.has(r.t) && (!r.ly || r.ly <= 0))
      .map((r) => ({ p: r.p, w: r.w, y: 0.1 }));
    this.cars = makeAgents(drivable, 32, [4.5, 8], 0);
    // keep-left offset relative to driving direction
    for (const car of this.cars) car.offset = 1.3 * car.dir;
    const n = this.cars.length;
    if (!n) return;

    const shell = new THREE.BoxGeometry(1.7, 0.78, 3.9);
    shell.translate(0, 0.76, 0);
    const skirt = new THREE.BoxGeometry(1.62, 0.3, 3.6);
    skirt.translate(0, 0.34, 0);
    const bodyGeo = mergeGeometries([shell, skirt], false)!;
    this.carBody = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    const cabinGeo = new THREE.BoxGeometry(1.5, 0.6, 1.9);
    cabinGeo.translate(0, 1.4, -0.2);
    this.carCabin = new THREE.InstancedMesh(cabinGeo, new THREE.MeshLambertMaterial({ color: 0x32383f }), n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.setHex(CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]);
      this.carBody.setColorAt(i, c);
    }
    // four wheels per car as one instanced geometry
    const wheelOne = new THREE.CylinderGeometry(0.31, 0.31, 0.2, 8);
    wheelOne.rotateZ(Math.PI / 2);
    const wheelGeos: THREE.BufferGeometry[] = [];
    for (const [wx, wz] of [[0.78, 1.25], [-0.78, 1.25], [0.78, -1.25], [-0.78, -1.25]]) {
      wheelGeos.push(wheelOne.clone().translate(wx, 0.31, wz));
    }
    wheelOne.dispose();
    this.carWheels = new THREE.InstancedMesh(
      mergeGeometries(wheelGeos, false)!,
      new THREE.MeshLambertMaterial({ color: 0x1d1e22 }),
      n,
    );
    wheelGeos.forEach((g) => g.dispose());
    this.carWheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carBody.castShadow = true;
    this.carBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carCabin.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.carBody, this.carCabin, this.carWheels);
    for (let i = 0; i < n; i++) {
      this.carSnapshots.push({ x: 0, y: 0, z: 0, id: `VEH-${String(i + 1).padStart(3, "0")}` });
    }
  }

  private initBuses(roads: Road[]): void {
    const routes = roads
      .filter((r) => BUS_ROADS.has(r.t) && (!r.ly || r.ly <= 0))
      .map((r) => ({ p: r.p, w: r.w, y: 0.1 }));
    this.buses = makeAgents(routes, 6, [3.2, 5], 0);
    for (const bus of this.buses) bus.offset = 1.9 * bus.dir; // keep-left, wide vehicle
    const n = this.buses.length;
    if (!n) return;

    const bodyGeo = new THREE.BoxGeometry(2.5, 2.7, 10.6);
    bodyGeo.translate(0, 1.95, 0);
    this.busBody = new THREE.InstancedMesh(
      bodyGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      n,
    );
    const winGeo = new THREE.BoxGeometry(2.56, 0.95, 9.4);
    winGeo.translate(0, 2.55, 0);
    this.busWindows = new THREE.InstancedMesh(
      winGeo,
      new THREE.MeshLambertMaterial({ color: 0x2c343c }),
      n,
    );
    const liveries = [0x3a7d6a, 0xdcd8c8, 0x4a6d8c]; // generic city-bus colors
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.setHex(liveries[i % liveries.length]);
      this.busBody.setColorAt(i, c);
    }
    const busWheel = new THREE.CylinderGeometry(0.48, 0.48, 0.3, 8);
    busWheel.rotateZ(Math.PI / 2);
    const busWheelGeos: THREE.BufferGeometry[] = [];
    for (const [wx, wz] of [[1.18, 3.4], [-1.18, 3.4], [1.18, -3.4], [-1.18, -3.4]]) {
      busWheelGeos.push(busWheel.clone().translate(wx, 0.48, wz));
    }
    busWheel.dispose();
    this.busWheels = new THREE.InstancedMesh(
      mergeGeometries(busWheelGeos, false)!,
      new THREE.MeshLambertMaterial({ color: 0x1d1e22 }),
      n,
    );
    busWheelGeos.forEach((g) => g.dispose());
    this.busWheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.busBody.castShadow = true;
    this.busBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.busWindows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.busBody, this.busWindows, this.busWheels);
    for (let i = 0; i < n; i++) {
      this.busSnapshots.push({ x: 0, y: 0, z: 0, id: `BUS-${String(i + 1).padStart(2, "0")}` });
    }
  }

  private initTrains(rails: Rail[]): void {
    // one train per line: pick the longest way of each named line
    const byLine = new Map<string, { rail: Rail; len: number }>();
    for (const r of rails) {
      const name = r.n ?? "rail";
      const { total } = cumulate(r.p);
      const cur = byLine.get(name);
      if (!cur || total > cur.len) byLine.set(name, { rail: r, len: total });
    }
    const lines = [...byLine.values()].filter((l) => l.len > 150).slice(0, 2);
    let totalCars = 0;
    for (const { rail, len } of lines) {
      const { cum, total } = cumulate(rail.p);
      const carCount = 4;
      this.trains.push({
        agent: {
          path: rail.p,
          cum,
          total,
          s: Math.random() * Math.max(1, total - carCount * 19),
          dir: 1,
          speed: 11,
          offset: 0,
          y: rail.el + 0.65,
          phase: 0,
        },
        carCount,
        spacing: 19,
      });
      totalCars += carCount;
      void len;
    }
    if (!totalCars) return;
    const carGeo = new THREE.BoxGeometry(2.9, 3.4, 18.2);
    carGeo.translate(0, 1.7, 0);
    this.trainCars = new THREE.InstancedMesh(
      carGeo,
      new THREE.MeshLambertMaterial({ color: 0xc8cdd2 }),
      totalCars,
    );
    const accent = new THREE.Color(0xb8373f); // warm red stripe tone, applied per car tint
    let idx = 0;
    for (const t of this.trains) {
      for (let k = 0; k < t.carCount; k++) {
        this.trainCars.setColorAt(idx++, k % 2 === 0 ? new THREE.Color(0xd4d8dc) : accent.clone().lerp(new THREE.Color(0xd4d8dc), 0.75));
      }
    }
    this.trainCars.castShadow = true;
    this.trainCars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.trainCars);
    this.trains.forEach((_t, i) => {
      this.trainSnapshots.push({ x: 0, y: 0, z: 0, id: `TRN-${String(i + 1).padStart(2, "0")}` });
    });
  }

  update(dt: number, time: number): void {
    const d = this.dummy;
    const smp = this.sampled;

    if (this.walkerBody) {
      this.walkers.forEach((w, i) => {
        step(w, dt);
        sample(w, smp);
        const bob = Math.sin(time * 7 + w.phase) * 0.035;
        d.position.set(smp.x, w.y + bob, smp.z);
        d.rotation.set(0, Math.atan2(smp.hx, smp.hz), 0);
        d.scale.setScalar(0.92 + 0.16 * ((i * 37) % 7) / 7);
        d.updateMatrix();
        this.walkerBody.setMatrixAt(i, d.matrix);
        this.walkerHead.setMatrixAt(i, d.matrix);
        const ws = this.walkerSnapshots[i];
        ws.x = smp.x; ws.y = w.y + 1.7; ws.z = smp.z;
      });
      this.walkerBody.instanceMatrix.needsUpdate = true;
      this.walkerHead.instanceMatrix.needsUpdate = true;
    }

    if (this.carBody) {
      this.cars.forEach((car, i) => {
        step(car, dt);
        // keep-left: lateral offset flips with travel direction
        car.offset = 1.3 * car.dir;
        sample(car, smp);
        d.position.set(smp.x, car.y, smp.z);
        d.rotation.set(0, Math.atan2(smp.hx, smp.hz), 0);
        d.scale.setScalar(1);
        d.updateMatrix();
        this.carBody.setMatrixAt(i, d.matrix);
        this.carCabin.setMatrixAt(i, d.matrix);
        this.carWheels.setMatrixAt(i, d.matrix);
        const cs = this.carSnapshots[i];
        cs.x = smp.x; cs.y = car.y + 2; cs.z = smp.z;
      });
      this.carBody.instanceMatrix.needsUpdate = true;
      this.carCabin.instanceMatrix.needsUpdate = true;
      this.carWheels.instanceMatrix.needsUpdate = true;
    }

    if (this.busBody) {
      this.buses.forEach((bus, i) => {
        step(bus, dt);
        bus.offset = 1.9 * bus.dir;
        sample(bus, smp);
        d.position.set(smp.x, bus.y, smp.z);
        d.rotation.set(0, Math.atan2(smp.hx, smp.hz), 0);
        d.scale.setScalar(1);
        d.updateMatrix();
        this.busBody.setMatrixAt(i, d.matrix);
        this.busWindows.setMatrixAt(i, d.matrix);
        this.busWheels.setMatrixAt(i, d.matrix);
        const bs = this.busSnapshots[i];
        bs.x = smp.x; bs.y = bus.y + 3.4; bs.z = smp.z;
      });
      this.busBody.instanceMatrix.needsUpdate = true;
      this.busWindows.instanceMatrix.needsUpdate = true;
      this.busWheels.instanceMatrix.needsUpdate = true;
    }

    if (this.trainCars) {
      let idx = 0;
      let ti = 0;
      for (const t of this.trains) {
        step(t.agent, dt);
        for (let k = 0; k < t.carCount; k++) {
          const save = t.agent.s;
          t.agent.s = Math.min(Math.max(save - k * t.spacing * t.agent.dir, 0), t.agent.total);
          sample(t.agent, smp);
          t.agent.s = save;
          d.position.set(smp.x, t.agent.y, smp.z);
          d.rotation.set(0, Math.atan2(smp.hx, smp.hz), 0);
          d.scale.setScalar(1);
          d.updateMatrix();
          this.trainCars.setMatrixAt(idx++, d.matrix);
          if (k === 0) {
            const ts = this.trainSnapshots[ti];
            if (ts) { ts.x = smp.x; ts.y = t.agent.y + 4.5; ts.z = smp.z; }
          }
        }
        ti++;
      }
      this.trainCars.instanceMatrix.needsUpdate = true;
    }
  }
}
