import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Area, Building, CityData, Pt, Rail, Road } from "./types";

export interface CityMeshes {
  group: THREE.Group;
  ground: THREE.Mesh;
  streetLights: THREE.Points;
  buildingMaterial: THREE.MeshLambertMaterial;
}

const DISPLAY_RADIUS = 320;

// deterministic pseudo-random (stable colors across loads)
function hash01(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function buildingColor(b: Building, i: number): THREE.Color {
  const r = hash01(i);
  const c = new THREE.Color();
  switch (b.t) {
    case "retail":
    case "commercial":
      c.setHSL(0.07 + r * 0.05, 0.22, 0.74 + r * 0.1); // warm shop tones
      break;
    case "train_station":
      c.setHSL(0.58, 0.18, 0.62);
      break;
    case "apartments":
    case "residential":
      c.setHSL(0.10 + r * 0.04, 0.10, 0.80 + r * 0.08);
      break;
    default:
      c.setHSL(0.09 + r * 0.06, 0.08 + r * 0.08, 0.78 + r * 0.12);
  }
  return c;
}

function withColor(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

function footprintShape(f: Pt[]): THREE.Shape {
  // shape XY plane -> rotateX(-90deg) maps (sx, sy) to world (x, -sy), so use sy = -z
  const shape = new THREE.Shape();
  shape.moveTo(f[0][0], -f[0][1]);
  for (let i = 1; i < f.length; i++) shape.lineTo(f[i][0], -f[i][1]);
  shape.closePath();
  return shape;
}

function buildBuildings(buildings: Building[]): { mesh: THREE.Mesh; material: THREE.MeshLambertMaterial } {
  const geos: THREE.BufferGeometry[] = [];
  buildings.forEach((b, i) => {
    if (b.f.length < 3) return;
    try {
      const geo = new THREE.ExtrudeGeometry(footprintShape(b.f), {
        depth: b.h,
        bevelEnabled: false,
      });
      geo.rotateX(-Math.PI / 2);
      geos.push(withColor(geo, buildingColor(b, i)));
    } catch {
      /* skip malformed footprint */
    }
  });
  const merged = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = "buildings";
  return { mesh, material };
}

/** Flat ribbon along a polyline (indexed geometry, y constant). */
function ribbonGeometry(p: Pt[], width: number, y: number, color: THREE.Color): THREE.BufferGeometry | null {
  const pts = p.filter((pt, i) => i === 0 || Math.hypot(pt[0] - p[i - 1][0], pt[1] - p[i - 1][1]) > 0.01);
  if (pts.length < 2) return null;
  const n = pts.length;
  const positions = new Float32Array(n * 2 * 3);
  const colors = new Float32Array(n * 2 * 3);
  const normals = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n * 2; i++) normals[i * 3 + 1] = 1; // flat ribbons face up
  const half = width / 2;
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const px = -dz, pz = dx; // perpendicular in XZ
    const [x, z] = pts[i];
    positions.set([x + px * half, y, z + pz * half], i * 6);
    positions.set([x - px * half, y, z - pz * half], i * 6 + 3);
    for (let k = 0; k < 2; k++) colors.set([color.r, color.g, color.b], i * 6 + k * 3);
  }
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

const ROAD_COLORS: Record<string, number> = {
  trunk: 0x4a4d52, primary: 0x50535a, secondary: 0x54575e, tertiary: 0x5a5d64,
  residential: 0x63666c, unclassified: 0x63666c, living_street: 0x6d6f74,
  service: 0x6b6d72, pedestrian: 0x8d8276, footway: 0x97897a, path: 0x91876f,
  steps: 0x8a7c6c, cycleway: 0x7a7468, track: 0x84765f,
};

function roadY(r: Road): number {
  const layer = r.ly && r.ly > 0 ? r.ly * 6 : 0;
  const minor = r.t === "footway" || r.t === "path" || r.t === "steps" ? 0.02 : 0;
  return 0.06 + layer + minor;
}

function buildRoads(roads: Road[]): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  for (const r of roads) {
    c.setHex(ROAD_COLORS[r.t] ?? 0x63666c);
    const g = ribbonGeometry(r.p, r.w, roadY(r), c);
    if (g) geos.push(g);
  }
  const merged = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = "roads";
  return mesh;
}

function buildRails(rails: Rail[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "rails";
  const trackGeos: THREE.BufferGeometry[] = [];
  const deckGeos: THREE.BufferGeometry[] = [];
  const pillarGeos: THREE.BufferGeometry[] = [];
  const trackColor = new THREE.Color(0x3a3d42);
  const deckColor = new THREE.Color(0x8e9094);

  for (const r of rails) {
    const t = ribbonGeometry(r.p, 2.6, r.el + 0.65, trackColor);
    if (t) trackGeos.push(t);
    if (r.el > 0) {
      const d = ribbonGeometry(r.p, 7.5, r.el + 0.4, deckColor);
      if (d) deckGeos.push(d);
      // support pillars every ~25 m
      let acc = 0;
      for (let i = 1; i < r.p.length; i++) {
        const [x0, z0] = r.p[i - 1];
        const [x1, z1] = r.p[i];
        const seg = Math.hypot(x1 - x0, z1 - z0);
        let dRemain = seg;
        while (acc + dRemain >= 25) {
          const need = 25 - acc;
          const f = (seg - dRemain + need) / seg;
          const px = x0 + (x1 - x0) * f;
          const pz = z0 + (z1 - z0) * f;
          const box = new THREE.BoxGeometry(1.4, r.el, 1.4);
          box.translate(px, r.el / 2, pz);
          pillarGeos.push(withColor(box, deckColor));
          dRemain -= need;
          acc = 0;
        }
        acc += dRemain;
      }
    }
  }
  if (trackGeos.length) {
    const m = new THREE.Mesh(mergeGeometries(trackGeos, false)!, new THREE.MeshLambertMaterial({ vertexColors: true }));
    group.add(m);
  }
  if (deckGeos.length) {
    const m = new THREE.Mesh(mergeGeometries(deckGeos, false)!, new THREE.MeshLambertMaterial({ vertexColors: true }));
    group.add(m);
  }
  if (pillarGeos.length) {
    const merged = mergeGeometries(pillarGeos, false)!;
    const m = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
    group.add(m);
  }
  return group;
}

function buildFlatAreas(areas: Area[], y: number, baseHex: number, varyHue = 0): THREE.Mesh | null {
  const geos: THREE.BufferGeometry[] = [];
  const base = new THREE.Color(baseHex);
  areas.forEach((a, i) => {
    if (a.f.length < 3) return;
    try {
      const geo = new THREE.ShapeGeometry(footprintShape(a.f));
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, y, 0);
      const c = base.clone();
      if (varyHue) c.offsetHSL(0, 0, (hash01(i) - 0.5) * 0.06);
      geos.push(withColor(geo, c));
    } catch {
      /* skip */
    }
  });
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  return new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

function buildPlatforms(platforms: { f: Pt[]; el: number }[]): THREE.Mesh | null {
  const geos: THREE.BufferGeometry[] = [];
  const c = new THREE.Color(0xa8a49c);
  for (const p of platforms) {
    if (p.f.length < 3) continue;
    try {
      const geo = new THREE.ExtrudeGeometry(footprintShape(p.f), { depth: 1.1, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, p.el, 0);
      geos.push(withColor(geo, c));
    } catch {
      /* skip */
    }
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  return new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

const LIT_ROADS = new Set(["residential", "pedestrian", "living_street", "tertiary", "secondary", "unclassified", "primary"]);

function buildStreetLights(roads: Road[]): THREE.Points {
  const pos: number[] = [];
  for (const r of roads) {
    if (!LIT_ROADS.has(r.t)) continue;
    let acc = 0;
    let side = 1;
    for (let i = 1; i < r.p.length; i++) {
      const [x0, z0] = r.p[i - 1];
      const [x1, z1] = r.p[i];
      const seg = Math.hypot(x1 - x0, z1 - z0);
      if (seg < 0.01) continue;
      const dx = (x1 - x0) / seg, dz = (z1 - z0) / seg;
      let dRemain = seg;
      while (acc + dRemain >= 28) {
        const need = 28 - acc;
        const f = (seg - dRemain + need) / seg;
        const off = (r.w / 2 + 0.8) * side;
        pos.push(x0 + (x1 - x0) * f - dz * off, 4.4, z0 + (z1 - z0) * f + dx * off);
        side = -side;
        dRemain -= need;
        acc = 0;
      }
      acc += dRemain;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffc66e,
    size: 2.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.name = "streetLights";
  points.visible = false;
  return points;
}

export function buildCity(data: CityData): CityMeshes {
  const group = new THREE.Group();
  group.name = "city";

  // ground disc
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(DISPLAY_RADIUS + 40, 64).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xb3b0a7 }),
  );
  ground.name = "ground";
  ground.position.y = -0.02;
  group.add(ground);

  const water = buildFlatAreas(data.water, 0.03, 0x7fa8c9);
  if (water) group.add(water);
  const green = buildFlatAreas(data.green, 0.04, 0x86a86a, 1);
  if (green) group.add(green);

  group.add(buildRoads(data.roads));
  group.add(buildRails(data.rails));
  const platforms = buildPlatforms(data.platforms);
  if (platforms) group.add(platforms);

  const { mesh: buildings, material: buildingMaterial } = buildBuildings(data.buildings);
  group.add(buildings);

  const streetLights = buildStreetLights(data.roads);
  group.add(streetLights);

  return { group, ground, streetLights, buildingMaterial };
}
