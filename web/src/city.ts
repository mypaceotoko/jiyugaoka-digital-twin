import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeFacadeTextures, makeGroundTexture, makeStorefrontTextures } from "./textures";
import type { Area, Building, CityData, Pt, Rail, Road } from "./types";

export interface CityMeshes {
  group: THREE.Group;
  ground: THREE.Mesh;
  streetLights: THREE.Points;
  lightPositions: Pt[];
  buildingMaterial: THREE.MeshStandardMaterial; // upper facade (windows glow at night)
  storefrontMaterial: THREE.MeshStandardMaterial; // ground floor (shop glow at night)
  /** merged building meshes carrying userData.ranges for tap-picking */
  pickMeshes: THREE.Mesh[];
}

interface PickRange {
  start: number; // first vertex of this building in the merged geometry
  end: number;
  idx: number; // index into data.buildings
}

/** Resolve a raycast hit on a merged building mesh to the source building index. */
export function pickBuildingIndex(mesh: THREE.Mesh, faceIndex: number): number | null {
  const ranges = mesh.userData.ranges as PickRange[] | undefined;
  if (!ranges) return null;
  const geo = mesh.geometry as THREE.BufferGeometry;
  const vi = geo.index ? geo.index.getX(faceIndex * 3) : faceIndex * 3;
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (vi < ranges[mid].start) hi = mid - 1;
    else if (vi >= ranges[mid].end) lo = mid + 1;
    else return ranges[mid].idx;
  }
  return null;
}

const DISPLAY_RADIUS = 320;
const FLOOR = 3.2; // meters per window cell
const BAND_H = 3.4; // ground-floor storefront height

// deterministic pseudo-random (stable colors across loads)
function hash01(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const AWNING = [0x9c2f38, 0x2f5d3f, 0x2e4668, 0xb07d2e, 0x8a4a2e, 0x3c3c41, 0x6e2f5d];

function buildingColor(b: Building, i: number): THREE.Color {
  const r1 = hash01(i);
  const r2 = hash01(i * 7 + 3);
  const c = new THREE.Color();
  if (b.t === "train_station") {
    c.setHSL(0.58, 0.16, 0.6);
  } else if (r2 < 0.1) {
    c.setHSL(0.06 + r1 * 0.02, 0.3 + r1 * 0.15, 0.42 + r1 * 0.15); // brick / brown
  } else if (r2 < 0.25) {
    c.setHSL(0.6, 0.02 + r1 * 0.03, 0.55 + r1 * 0.2); // cool gray
  } else if (r2 < 0.34) {
    c.setHSL(0.1, 0.04, 0.92); // near white
  } else {
    c.setHSL(0.07 + r1 * 0.06, 0.08 + r1 * 0.14, 0.74 + r1 * 0.16); // beige family
  }
  return c;
}

function awningColor(b: Building, i: number): THREE.Color {
  const retail = b.t === "retail" || b.t === "commercial" || !!b.n;
  const r = hash01(i * 13 + 5);
  if (retail || r < 0.4) {
    const c = new THREE.Color(AWNING[Math.floor(hash01(i * 3 + 1) * AWNING.length)]);
    c.offsetHSL(0, 0, (r - 0.5) * 0.08);
    return c;
  }
  return buildingColor(b, i).multiplyScalar(0.88);
}

interface WallGeos {
  upper: THREE.BufferGeometry | null;
  band: THREE.BufferGeometry;
}

/** Walls split into a storefront band (0..BAND_H) and upper window floors. */
function buildingWallGeometry(b: Building, color: THREE.Color, accent: THREE.Color): WallGeos {
  const f = b.f;
  const n = f.length;
  const bandH = Math.min(b.h, BAND_H);
  const hasUpper = b.h > BAND_H + 0.3;

  const mk = () => ({ pos: [] as number[], nor: [] as number[], uv: [] as number[], col: [] as number[] });
  const band = mk();
  const upper = mk();

  const pushQuad = (
    dst: ReturnType<typeof mk>,
    x0: number, z0: number, x1: number, z1: number,
    y0: number, y1: number, nx: number, nz: number,
    u1: number, v0: number, v1: number,
    cBottom: THREE.Color, cTop: THREE.Color,
  ) => {
    const quadPos = [
      [x0, y0, z0], [x1, y0, z1], [x1, y1, z1],
      [x0, y0, z0], [x1, y1, z1], [x0, y1, z0],
    ];
    const quadUv = [
      [0, v0], [u1, v0], [u1, v1],
      [0, v0], [u1, v1], [0, v1],
    ];
    const quadCol = [cBottom, cBottom, cTop, cBottom, cTop, cTop];
    for (let k = 0; k < 6; k++) {
      dst.pos.push(...quadPos[k]);
      dst.nor.push(nx, 0, nz);
      dst.uv.push(...quadUv[k]);
      dst.col.push(quadCol[k].r, quadCol[k].g, quadCol[k].b);
    }
  };

  const upperDark = color.clone().multiplyScalar(0.82);
  for (let i = 0; i < n; i++) {
    const [x0, z0] = f[i];
    const [x1, z1] = f[(i + 1) % n];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05) continue;
    const nx = (z1 - z0) / len;
    const nz = -(x1 - x0) / len;
    const u1 = Math.max(1, Math.round(len / FLOOR));
    // storefront band: single texture tile vertically
    pushQuad(band, x0, z0, x1, z1, 0, bandH, nx, nz, u1, 0, 1, accent, accent);
    if (hasUpper) {
      const v1 = Math.max(1, Math.round((b.h - bandH) / FLOOR));
      pushQuad(upper, x0, z0, x1, z1, bandH, b.h, nx, nz, u1, 0, v1, upperDark, color);
    }
  }

  const toGeo = (d: ReturnType<typeof mk>) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(d.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(d.nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(d.uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(d.col, 3));
    return geo;
  };
  return { upper: hasUpper ? toGeo(upper) : null, band: toGeo(band) };
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

function buildBuildings(buildings: Building[]): {
  meshes: THREE.Mesh[];
  facade: THREE.MeshStandardMaterial;
  storefront: THREE.MeshStandardMaterial;
} {
  const upperGeos: THREE.BufferGeometry[] = [];
  const bandGeos: THREE.BufferGeometry[] = [];
  const roofGeos: THREE.BufferGeometry[] = [];
  const upperIdx: number[] = [];
  const bandIdx: number[] = [];
  const roofIdx: number[] = [];
  buildings.forEach((b, i) => {
    if (b.f.length < 3) return;
    const color = buildingColor(b, i);
    try {
      const { upper, band } = buildingWallGeometry(b, color, awningColor(b, i));
      if (upper) {
        upperGeos.push(upper);
        upperIdx.push(i);
      }
      bandGeos.push(band);
      bandIdx.push(i);
      const roof = new THREE.ShapeGeometry(footprintShape(b.f));
      roof.rotateX(-Math.PI / 2);
      roof.translate(0, b.h, 0);
      const roofColor = color.clone().multiplyScalar(0.8).lerp(new THREE.Color(0x8d8d8a), 0.35);
      roofGeos.push(withColor(roof, roofColor));
      roofIdx.push(i);
    } catch {
      /* skip malformed footprint */
    }
  });

  const win = makeFacadeTextures();
  const facade = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: win.map,
    emissiveMap: win.emissiveMap,
    emissive: new THREE.Color(0xffc88a),
    emissiveIntensity: 0,
    roughness: 0.82,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const shop = makeStorefrontTextures();
  const storefront = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: shop.map,
    emissiveMap: shop.emissiveMap,
    emissive: new THREE.Color(0xfff0cf),
    emissiveIntensity: 0,
    roughness: 0.6,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });

  const meshes: THREE.Mesh[] = [];
  const add = (geos: THREE.BufferGeometry[], idxs: number[], mat: THREE.Material, name: string) => {
    if (!geos.length) return;
    const ranges: PickRange[] = [];
    let offset = 0;
    geos.forEach((g, k) => {
      const count = g.attributes.position.count;
      ranges.push({ start: offset, end: offset + count, idx: idxs[k] });
      offset += count;
    });
    const merged = mergeGeometries(geos, false)!;
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.ranges = ranges;
    meshes.push(mesh);
  };
  add(upperGeos, upperIdx, facade, "buildingWalls");
  add(bandGeos, bandIdx, storefront, "buildingStorefronts");
  add(roofGeos, roofIdx, roofMat, "buildingRoofs");
  return { meshes, facade, storefront };
}

/** Flat ribbon along a polyline (indexed, y constant, optional lateral offset). */
function ribbonGeometry(
  p: Pt[],
  width: number,
  y: number,
  color: THREE.Color,
  centerOffset = 0,
): THREE.BufferGeometry | null {
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
    const x = pts[i][0] + px * centerOffset;
    const z = pts[i][1] + pz * centerOffset;
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
  trunk: 0x3c3e43, primary: 0x404247, secondary: 0x44464b, tertiary: 0x494b50,
  residential: 0x4f5156, unclassified: 0x4f5156, living_street: 0x595a5e,
  service: 0x57585c, pedestrian: 0x9b8c79, footway: 0xa3937e, path: 0x97896c,
  steps: 0x8a7c6c, cycleway: 0x7a7468, track: 0x84765f,
};
const SIDEWALK_ROADS = new Set(["primary", "secondary", "tertiary", "residential", "unclassified"]);
const LINE_ROADS = new Set(["primary", "secondary", "tertiary"]);

function roadY(r: Road): number {
  const layer = r.ly && r.ly > 0 ? r.ly * 6 : 0;
  const minor = r.t === "footway" || r.t === "path" || r.t === "steps" ? 0.02 : 0;
  return 0.06 + layer + minor;
}

function buildRoads(roads: Road[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "roads";
  const geos: THREE.BufferGeometry[] = [];
  const walkGeos: THREE.BufferGeometry[] = [];
  const lineGeos: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  const sidewalkColor = new THREE.Color(0xb9b2a4);
  const lineColor = new THREE.Color(0xd9d9d2);

  for (const r of roads) {
    c.setHex(ROAD_COLORS[r.t] ?? 0x4f5156);
    const y = roadY(r);
    const g = ribbonGeometry(r.p, r.w, y, c);
    if (g) geos.push(g);

    if (SIDEWALK_ROADS.has(r.t) && (!r.ly || r.ly <= 0) && !r.b) {
      for (const side of [1, -1]) {
        const sw = ribbonGeometry(r.p, 1.7, 0.045, sidewalkColor, side * (r.w / 2 + 0.85));
        if (sw) walkGeos.push(sw);
      }
    }
    if (LINE_ROADS.has(r.t)) {
      // dashed center line
      let acc = 0;
      for (let i = 1; i < r.p.length; i++) {
        const [x0, z0] = r.p[i - 1];
        const [x1, z1] = r.p[i];
        const seg = Math.hypot(x1 - x0, z1 - z0);
        if (seg < 0.01) continue;
        const dx = (x1 - x0) / seg, dz = (z1 - z0) / seg;
        let pos = 0;
        while (pos < seg) {
          const phase = (acc + pos) % 6.5;
          if (phase < 2.5) {
            const dashLen = Math.min(2.5 - phase, seg - pos);
            const sx = x0 + dx * pos, sz = z0 + dz * pos;
            const ex = sx + dx * dashLen, ez = sz + dz * dashLen;
            const d = ribbonGeometry([[sx, sz], [ex, ez]], 0.16, y + 0.015, lineColor);
            if (d) lineGeos.push(d);
            pos += dashLen;
          } else {
            pos += 6.5 - phase;
          }
        }
        acc += seg;
      }
    }
  }

  const mat = () => new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const [geoList, name] of [[geos, "asphalt"], [walkGeos, "sidewalks"], [lineGeos, "centerlines"]] as const) {
    if (!geoList.length) continue;
    const merged = mergeGeometries(geoList, false)!;
    geoList.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, mat());
    mesh.name = name;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
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
  const addMesh = (geos: THREE.BufferGeometry[], cast: boolean) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos, false)!, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
  };
  addMesh(trackGeos, false);
  addMesh(deckGeos, true);
  addMesh(pillarGeos, true);
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
  const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
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
  const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const LIT_ROADS = new Set(["residential", "pedestrian", "living_street", "tertiary", "secondary", "unclassified", "primary"]);

/** Street light positions sampled along major walkable roads. */
export function computeLightPositions(roads: Road[]): Pt[] {
  const out: Pt[] = [];
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
        out.push([x0 + (x1 - x0) * f - dz * off, z0 + (z1 - z0) * f + dx * off]);
        side = -side;
        dRemain -= need;
        acc = 0;
      }
      acc += dRemain;
    }
  }
  return out;
}

function buildStreetLights(positions: Pt[]): THREE.Points {
  const pos: number[] = [];
  for (const [x, z] of positions) pos.push(x, 4.4, z);
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

  // ground disc with subtle noise texture
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(DISPLAY_RADIUS + 40, 64).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xcfcabc, map: makeGroundTexture() }),
  );
  ground.name = "ground";
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  group.add(ground);

  const water = buildFlatAreas(data.water, 0.03, 0x7fa8c9);
  if (water) group.add(water);
  const green = buildFlatAreas(data.green, 0.04, 0x7da45e, 1);
  if (green) group.add(green);

  group.add(buildRoads(data.roads));
  group.add(buildRails(data.rails));
  const platforms = buildPlatforms(data.platforms);
  if (platforms) group.add(platforms);

  const { meshes, facade, storefront } = buildBuildings(data.buildings);
  group.add(...meshes);

  const lightPositions = computeLightPositions(data.roads);
  const streetLights = buildStreetLights(lightPositions);
  group.add(streetLights);

  return {
    group,
    ground,
    streetLights,
    lightPositions,
    buildingMaterial: facade,
    storefrontMaterial: storefront,
    pickMeshes: meshes,
  };
}
