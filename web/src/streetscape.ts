import * as THREE from "three";
import type { Area, Building, CityData, Pt, Road } from "./types";

const TREE_ROADS = new Set(["pedestrian", "footway", "living_street", "residential"]);

function pointInPolygon(x: number, z: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function treeSpots(roads: Road[], green: Area[]): Pt[] {
  const out: Pt[] = [];
  // along walkable streets
  for (const r of roads) {
    if (!TREE_ROADS.has(r.t)) continue;
    let acc = 14; // phase-shift vs street lights
    let side = -1;
    for (let i = 1; i < r.p.length; i++) {
      const [x0, z0] = r.p[i - 1];
      const [x1, z1] = r.p[i];
      const seg = Math.hypot(x1 - x0, z1 - z0);
      if (seg < 0.01) continue;
      const dx = (x1 - x0) / seg, dz = (z1 - z0) / seg;
      let dRemain = seg;
      while (acc + dRemain >= 34) {
        const need = 34 - acc;
        const f = (seg - dRemain + need) / seg;
        const off = (r.w / 2 + 1.6) * side;
        out.push([x0 + (x1 - x0) * f - dz * off, z0 + (z1 - z0) * f + dx * off]);
        side = -side;
        dRemain -= need;
        acc = 0;
      }
      acc += dRemain;
    }
  }
  // inside parks / green areas (grid sampling)
  for (const a of green) {
    const xs = a.f.map((p) => p[0]);
    const zs = a.f.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    for (let x = minX; x <= maxX; x += 9) {
      for (let z = minZ; z <= maxZ; z += 9) {
        const jx = x + (Math.random() - 0.5) * 4;
        const jz = z + (Math.random() - 0.5) * 4;
        if (pointInPolygon(jx, jz, a.f)) out.push([jx, jz]);
      }
    }
  }
  return out;
}

function polygonArea(f: Pt[]): number {
  let a = 0;
  for (let i = 0, j = f.length - 1; i < f.length; j = i++) {
    a += (f[j][0] + f[i][0]) * (f[j][1] - f[i][1]);
  }
  return Math.abs(a / 2);
}

/** Rooftop AC units / water tanks on larger buildings (aerial-view detail). */
function buildRooftopClutter(buildings: Building[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "rooftops";
  const boxes: { x: number; y: number; z: number; s: number; r: number }[] = [];
  const tanks: { x: number; y: number; z: number; s: number }[] = [];
  buildings.forEach((b, i) => {
    if (b.h < 8 || b.f.length < 3) return;
    const area = polygonArea(b.f);
    if (area < 90) return;
    let cx = 0, cz = 0;
    for (const p of b.f) { cx += p[0]; cz += p[1]; }
    cx /= b.f.length; cz /= b.f.length;
    const r1 = Math.sin(i * 12.9898) * 43758.5453;
    const rnd = (k: number) => {
      const v = Math.sin((i + k) * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    const jitter = Math.min(Math.sqrt(area) * 0.18, 6);
    const n = 1 + Math.floor(rnd(1) * 2.4);
    for (let k = 0; k < n; k++) {
      boxes.push({
        x: cx + (rnd(k * 2 + 2) - 0.5) * jitter * 2,
        y: b.h,
        z: cz + (rnd(k * 2 + 3) - 0.5) * jitter * 2,
        s: 0.9 + rnd(k + 4) * 1.4,
        r: rnd(k + 5) * Math.PI,
      });
    }
    if (area > 220 && (r1 - Math.floor(r1)) < 0.3) {
      tanks.push({ x: cx + (rnd(9) - 0.5) * jitter, y: b.h, z: cz + (rnd(10) - 0.5) * jitter, s: 1 });
    }
  });

  const dummy = new THREE.Object3D();
  if (boxes.length) {
    const geo = new THREE.BoxGeometry(1.4, 0.9, 1.1);
    geo.translate(0, 0.45, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.8 }), boxes.length);
    boxes.forEach((bx, i) => {
      dummy.position.set(bx.x, bx.y, bx.z);
      dummy.scale.setScalar(bx.s);
      dummy.rotation.set(0, bx.r, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = true;
    group.add(mesh);
  }
  if (tanks.length) {
    const geo = new THREE.CylinderGeometry(1.1, 1.1, 2, 10);
    geo.translate(0, 1, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.7 }), tanks.length);
    tanks.forEach((t, i) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.scale.setScalar(t.s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Static greenery + street furniture (instanced; a handful of draw calls). */
export function buildStreetscape(data: CityData, lightPositions: Pt[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "streetscape";
  const dummy = new THREE.Object3D();

  // --- trees ---
  const spots = treeSpots(data.roads, data.green);
  if (spots.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 2.4, 5);
    trunkGeo.translate(0, 1.2, 0);
    const trunks = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshLambertMaterial({ color: 0x6b4f35 }),
      spots.length,
    );
    const crownGeo = new THREE.IcosahedronGeometry(1.7, 0);
    crownGeo.translate(0, 3.1, 0);
    const crowns = new THREE.InstancedMesh(
      crownGeo,
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      spots.length,
    );
    const c = new THREE.Color();
    spots.forEach(([x, z], i) => {
      const s = 0.75 + Math.random() * 0.7;
      dummy.position.set(x, 0, z);
      dummy.scale.setScalar(s);
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      crowns.setMatrixAt(i, dummy.matrix);
      c.setHSL(0.26 + Math.random() * 0.08, 0.45, 0.3 + Math.random() * 0.14);
      crowns.setColorAt(i, c);
    });
    trunks.castShadow = true;
    crowns.castShadow = true;
    group.add(trunks, crowns);
  }

  // --- lamp poles (heads glow via the streetLights points layer) ---
  if (lightPositions.length) {
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.09, 4.4, 4);
    poleGeo.translate(0, 2.2, 0);
    const poles = new THREE.InstancedMesh(
      poleGeo,
      new THREE.MeshLambertMaterial({ color: 0x4a4d52 }),
      lightPositions.length,
    );
    lightPositions.forEach(([x, z], i) => {
      dummy.position.set(x, 0, z);
      dummy.scale.setScalar(1);
      dummy.rotation.y = 0;
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
    });
    poles.castShadow = true;
    group.add(poles);
  }

  group.add(buildRooftopClutter(data.buildings));
  return group;
}
