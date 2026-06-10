import * as THREE from "three";
import type { Area, CityData, Pt, Road } from "./types";

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
    group.add(poles);
  }

  return group;
}
