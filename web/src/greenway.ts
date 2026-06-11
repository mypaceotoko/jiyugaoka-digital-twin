import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeLabelSprite, makePaverTexture } from "./textures";
import type { CityData, Pt, Road } from "./types";

/**
 * 九品仏川緑道 (Kuhonbutsu-gawa green path) — hand-detailed landmark:
 * brick-paved promenade, dense cherry-tree rows, benches, planters,
 * bollards and drifting petals along the OSM polylines of the path.
 */

export interface Greenway {
  group: THREE.Group;
  /** roads consumed here (excluded from the generic streetscape trees) */
  roads: Set<Road>;
  update(dt: number): void;
}

const PATH_WIDTH = 7;
const PAVE_Y = 0.1;

interface GreenwayLines {
  lines: Pt[][];
  used: Set<Road>;
}

/** Offset a polyline laterally; sign chosen once so it moves away from the origin. */
function offsetLine(p: Pt[], d: number): Pt[] {
  const mi = Math.floor(p.length / 2);
  const mPrev = p[Math.max(0, mi - 1)];
  const mNext = p[Math.min(p.length - 1, mi + 1)];
  let mdx = mNext[0] - mPrev[0];
  let mdz = mNext[1] - mPrev[1];
  const mlen = Math.hypot(mdx, mdz) || 1;
  const sign = (-mdz / mlen) * p[mi][0] + (mdx / mlen) * p[mi][1] >= 0 ? 1 : -1;
  return p.map((pt, i) => {
    const prev = p[Math.max(0, i - 1)];
    const next = p[Math.min(p.length - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    return [pt[0] - dz * d * sign, pt[1] + dx * d * sign];
  });
}

function findGreenwayLines(data: CityData): GreenwayLines {
  const used = new Set<Road>();
  // 1) explicitly named greenway ways (if present in OSM)
  const byName = data.roads.filter((r) => r.n && /九品仏|緑道/.test(r.n));
  if (byName.length) {
    for (const r of byName) used.add(r);
    return { lines: byName.map((r) => r.p), used };
  }
  // 2) the real green path runs immediately parallel to マリクレール通り
  //    (south side, away from the station) — derive it by lateral offset
  const mc = data.roads.filter((r) => r.n && /マリクレール/.test(r.n));
  if (mc.length) {
    const src = mc.reduce((a, b) => (b.p.length > a.p.length ? b : a));
    return { lines: [offsetLine(src.p, 11)], used };
  }
  return { lines: [], used };
}

/** Walk a polyline emitting evenly spaced samples with direction. */
function walkPath(
  p: Pt[],
  spacing: number,
  phase: number,
  cb: (x: number, z: number, dx: number, dz: number, i: number) => void,
): void {
  let acc = phase;
  let idx = 0;
  for (let i = 1; i < p.length; i++) {
    const [x0, z0] = p[i - 1];
    const [x1, z1] = p[i];
    const seg = Math.hypot(x1 - x0, z1 - z0);
    if (seg < 0.01) continue;
    const dx = (x1 - x0) / seg;
    const dz = (z1 - z0) / seg;
    let remain = seg;
    while (acc + remain >= spacing) {
      const need = spacing - acc;
      const f = (seg - remain + need) / seg;
      cb(x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, dx, dz, idx++);
      remain -= need;
      acc = 0;
    }
    acc += remain;
  }
}

/** Ribbon with arc-length UVs (for the paver texture). */
function pavedRibbon(p: Pt[], width: number, y: number): THREE.BufferGeometry | null {
  const pts = p.filter((pt, i) => i === 0 || Math.hypot(pt[0] - p[i - 1][0], pt[1] - p[i - 1][1]) > 0.01);
  if (pts.length < 2) return null;
  const n = pts.length;
  const positions = new Float32Array(n * 2 * 3);
  const normals = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n * 2; i++) normals[i * 3 + 1] = 1;
  const half = width / 2;
  let arc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) arc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const px = -dz, pz = dx;
    const [x, z] = pts[i];
    positions.set([x + px * half, y, z + pz * half], i * 6);
    positions.set([x - px * half, y, z - pz * half], i * 6 + 3);
    uvs.set([arc / 2.6, 0], i * 4);
    uvs.set([arc / 2.6, 1.35], i * 4 + 2);
  }
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function sakuraCrownGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.IcosahedronGeometry(1.7, 1).translate(0, 3.6, 0),
    new THREE.IcosahedronGeometry(1.25, 1).translate(1.0, 3.0, 0.35),
    new THREE.IcosahedronGeometry(1.1, 1).translate(-0.9, 3.2, -0.4),
  ];
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

function benchGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.BoxGeometry(1.7, 0.07, 0.5).translate(0, 0.43, 0),
    new THREE.BoxGeometry(1.7, 0.42, 0.06).translate(0, 0.74, -0.25),
    new THREE.BoxGeometry(0.08, 0.43, 0.46).translate(0.72, 0.21, 0),
    new THREE.BoxGeometry(0.08, 0.43, 0.46).translate(-0.72, 0.21, 0),
  ];
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

export function buildGreenway(data: CityData): Greenway {
  const group = new THREE.Group();
  group.name = "greenway";
  const { lines, used: roads } = findGreenwayLines(data);
  const noop = { group, roads, update: () => {} };
  if (!lines.length) return noop;

  const dummy = new THREE.Object3D();

  // --- paved promenade ---
  const paveGeos: THREE.BufferGeometry[] = [];
  for (const line of lines) {
    const g = pavedRibbon(line, PATH_WIDTH, PAVE_Y);
    if (g) paveGeos.push(g);
  }
  if (paveGeos.length) {
    const merged = mergeGeometries(paveGeos, false)!;
    paveGeos.forEach((g) => g.dispose());
    const pave = new THREE.Mesh(
      merged,
      new THREE.MeshLambertMaterial({ map: makePaverTexture(), color: 0xfff6ea }),
    );
    pave.receiveShadow = true;
    group.add(pave);
  }

  // --- collect placement samples along all lines ---
  const sakura: { x: number; z: number; s: number }[] = [];
  const benches: { x: number; z: number; yaw: number }[] = [];
  const planters: { x: number; z: number; yaw: number }[] = [];
  const bollards: { x: number; z: number }[] = [];
  const petalBases: Pt[] = [];
  let centerSum = new THREE.Vector3();
  let centerCount = 0;
  let longest: { len: number; mid: Pt } | null = null;

  const rng = (() => {
    let s = 7;
    return () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
  })();

  for (const line of lines) {
    let len = 0;
    for (let i = 1; i < line.length; i++) {
      len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    }
    const mid = line[Math.floor(line.length / 2)];
    if (!longest || len > longest.len) longest = { len, mid };

    let side = 1;
    walkPath(line, 7.5, 3, (x, z, dx, dz) => {
      const off = (PATH_WIDTH / 2 - 0.5) * side;
      sakura.push({
        x: x - dz * off + (rng() - 0.5) * 0.8,
        z: z + dx * off + (rng() - 0.5) * 0.8,
        s: 0.85 + rng() * 0.45,
      });
      side = -side;
      centerSum.add(new THREE.Vector3(x, 0, z));
      centerCount++;
    });

    let bSide = 1;
    walkPath(line, 17, 9, (x, z, dx, dz) => {
      const off = 2.1 * bSide;
      benches.push({
        x: x - dz * off,
        z: z + dx * off,
        // face the centre of the path
        yaw: Math.atan2(dx, dz) + (bSide > 0 ? Math.PI / 2 : -Math.PI / 2) + Math.PI,
      });
      bSide = -bSide;
    });

    let pSide = -1;
    walkPath(line, 13, 1.5, (x, z, dx, dz) => {
      const off = 2.6 * pSide;
      planters.push({ x: x - dz * off, z: z + dx * off, yaw: Math.atan2(dx, dz) });
      pSide = -pSide;
    });

    walkPath(line, 4, 0, (x, z) => petalBases.push([x, z]));

    // bollards across both ends
    for (const end of [line[0], line[line.length - 1]]) {
      const next = end === line[0] ? line[1] : line[line.length - 2];
      const dx = next[0] - end[0], dz = next[1] - end[1];
      const len2 = Math.hypot(dx, dz) || 1;
      const px = -dz / len2, pz = dx / len2;
      for (const k of [-1.4, 0, 1.4]) {
        bollards.push({ x: end[0] + px * k, z: end[1] + pz * k });
      }
    }
  }

  // --- cherry trees ---
  if (sakura.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 2.6, 6);
    trunkGeo.translate(0, 1.3, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5a4434 }), sakura.length);
    const crowns = new THREE.InstancedMesh(
      sakuraCrownGeometry(),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      sakura.length,
    );
    const c = new THREE.Color();
    sakura.forEach((t, i) => {
      dummy.position.set(t.x, PAVE_Y, t.z);
      dummy.scale.setScalar(t.s);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      crowns.setMatrixAt(i, dummy.matrix);
      c.setHSL(0.93 + rng() * 0.05, 0.38, 0.8 + rng() * 0.07);
      crowns.setColorAt(i, c);
    });
    trunks.castShadow = true;
    crowns.castShadow = true;
    group.add(trunks, crowns);
  }

  // --- benches ---
  if (benches.length) {
    const mesh = new THREE.InstancedMesh(
      benchGeometry(),
      new THREE.MeshLambertMaterial({ color: 0x7a5b3e }),
      benches.length,
    );
    benches.forEach((b, i) => {
      dummy.position.set(b.x, PAVE_Y, b.z);
      dummy.scale.setScalar(1);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = true;
    group.add(mesh);
  }

  // --- planters with shrubs ---
  if (planters.length) {
    const boxGeo = new THREE.BoxGeometry(1.8, 0.45, 0.6);
    boxGeo.translate(0, 0.22, 0);
    const boxes = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x8d8478 }), planters.length);
    const shrubGeo = new THREE.IcosahedronGeometry(0.42, 0);
    shrubGeo.translate(0, 0.62, 0);
    const shrubs = new THREE.InstancedMesh(shrubGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), planters.length);
    const c = new THREE.Color();
    planters.forEach((pl, i) => {
      dummy.position.set(pl.x, PAVE_Y, pl.z);
      dummy.scale.setScalar(1);
      dummy.rotation.set(0, pl.yaw, 0);
      dummy.updateMatrix();
      boxes.setMatrixAt(i, dummy.matrix);
      shrubs.setMatrixAt(i, dummy.matrix);
      // mostly green shrubs, some azalea-pink
      if (rng() < 0.3) c.setHSL(0.95, 0.5, 0.68);
      else c.setHSL(0.3 + rng() * 0.06, 0.42, 0.3 + rng() * 0.1);
      shrubs.setColorAt(i, c);
    });
    boxes.castShadow = true;
    group.add(boxes, shrubs);
  }

  // --- bollards ---
  if (bollards.length) {
    const geo = new THREE.CylinderGeometry(0.09, 0.1, 0.75, 6);
    geo.translate(0, 0.37, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x55534e }), bollards.length);
    bollards.forEach((b, i) => {
      dummy.position.set(b.x, PAVE_Y, b.z);
      dummy.scale.setScalar(1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = true;
    group.add(mesh);
  }

  // --- drifting petals ---
  const PETALS = 180;
  const petalPos = new Float32Array(PETALS * 3);
  const petalPhase = new Float32Array(PETALS);
  const petalSpeed = new Float32Array(PETALS);
  const respawn = (i: number) => {
    const base = petalBases[Math.floor(rng() * petalBases.length)] ?? [0, 120];
    petalPos[i * 3] = base[0] + (rng() - 0.5) * 7;
    petalPos[i * 3 + 1] = 1.5 + rng() * 5.5;
    petalPos[i * 3 + 2] = base[1] + (rng() - 0.5) * 7;
  };
  for (let i = 0; i < PETALS; i++) {
    respawn(i);
    petalPhase[i] = rng() * Math.PI * 2;
    petalSpeed[i] = 0.35 + rng() * 0.35;
  }
  const petalGeo = new THREE.BufferGeometry();
  petalGeo.setAttribute("position", new THREE.BufferAttribute(petalPos, 3).setUsage(THREE.DynamicDrawUsage));
  const petals = new THREE.Points(
    petalGeo,
    new THREE.PointsMaterial({
      color: 0xffd7e2,
      size: 0.34,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    }),
  );
  petals.name = "petals";
  group.add(petals);

  // --- name label over the longest stretch ---
  if (longest) {
    const label = makeLabelSprite("九品仏川緑道", "Kuhonbutsugawa Green Path");
    label.scale.set(36, 11.2, 1);
    label.position.set(longest.mid[0], 16, longest.mid[1]);
    group.add(label);
  }

  let t = 0;
  const update = (dt: number): void => {
    t += dt;
    for (let i = 0; i < PETALS; i++) {
      petalPos[i * 3 + 1] -= petalSpeed[i] * dt;
      petalPos[i * 3] += Math.sin(t * 1.4 + petalPhase[i]) * 0.45 * dt;
      petalPos[i * 3 + 2] += Math.cos(t * 1.1 + petalPhase[i]) * 0.3 * dt;
      if (petalPos[i * 3 + 1] < 0.15) respawn(i);
    }
    petalGeo.attributes.position.needsUpdate = true;
  };

  return { group, roads, update };
}
