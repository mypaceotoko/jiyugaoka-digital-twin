#!/usr/bin/env node
/**
 * Convert raw Overpass JSON into the runtime city data (city.json).
 *
 * - Projects WGS84 -> EPSG:6677 (Japan Plane Rectangular CS IX, JGD2011)
 * - Offsets to the local origin (Jiyugaoka Station, see docs/area-definition.md)
 * - Classifies features (buildings / roads / rails / platforms / green / water / POIs)
 * - Rounds coordinates to cm precision to keep the payload small
 *
 * Output: data/processed/city.json + copy to web/public/data/city.json
 *
 * Derived OSM data is ODbL 1.0 — (c) OpenStreetMap contributors.
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import proj4 from "proj4";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data", "raw", "osm");
const OUT = join(ROOT, "data", "processed");
const WEB_DATA = join(ROOT, "web", "public", "data");

// --- area definition (docs/area-definition.md) ---
const EPSG6677 =
  "+proj=tmerc +lat_0=36 +lon_0=139.833333333333 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs";
const ORIGIN_LL = [139.669, 35.6075]; // lon, lat
const [ORIGIN_E, ORIGIN_N] = proj4("EPSG:4326", EPSG6677, ORIGIN_LL);
const CLIP_BUILDING = 320; // m (display radius 300 + margin)
const CLIP_LINE = 345;
const CLIP_POI = 300;

const ROAD_WIDTHS = {
  trunk: 18, primary: 13, secondary: 11, tertiary: 8,
  unclassified: 5, residential: 5.5, living_street: 4.5, service: 3.5,
  pedestrian: 5, footway: 2, path: 1.8, cycleway: 2, steps: 2, track: 3,
};
const ROAD_SKIP = new Set(["proposed", "construction", "corridor", "elevator", "platform"]);
const GREEN_LEISURE = new Set(["park", "garden"]);
const GREEN_LANDUSE = new Set(["grass", "forest", "village_green", "recreation_ground"]);

// --- load ---
const raw = JSON.parse(readFileSync(join(RAW, "osm_raw.json"), "utf8"));
const fetchMeta = JSON.parse(readFileSync(join(RAW, "meta.json"), "utf8"));

const nodes = new Map(); // id -> {lat, lon, tags?}
const ways = new Map(); // id -> {nodes: [], tags: {}}
const rels = [];
for (const el of raw.elements) {
  if (el.type === "node") nodes.set(el.id, el);
  else if (el.type === "way") ways.set(el.id, el);
  else if (el.type === "relation") rels.push(el);
}

const r2 = (v) => Math.round(v * 100) / 100;

/** lon/lat -> local [x, z] (x = east, z = south; matches Three.js axes, y-up) */
function toLocal(lon, lat) {
  const [e, n] = proj4("EPSG:4326", EPSG6677, [lon, lat]);
  return [r2(e - ORIGIN_E), r2(-(n - ORIGIN_N))];
}

function wayCoords(way) {
  const pts = [];
  for (const id of way.nodes) {
    const nd = nodes.get(id);
    if (nd) pts.push(toLocal(nd.lon, nd.lat));
  }
  return pts;
}

const dist = ([x, z]) => Math.hypot(x, z);
const centroid = (pts) => {
  let x = 0, z = 0;
  for (const p of pts) { x += p[0]; z += p[1]; }
  return [x / pts.length, z / pts.length];
};

function parseHeight(tags) {
  if (tags.height) {
    const h = parseFloat(String(tags.height).replace(/m$/i, "").trim());
    if (!Number.isNaN(h) && h > 0) return r2(h);
  }
  const lv = parseFloat(tags["building:levels"]);
  if (!Number.isNaN(lv) && lv > 0) return r2(lv * 3.2);
  return 8;
}

/** Stitch relation member ways into closed rings (node-id space). */
function assembleRings(memberWays) {
  const segs = memberWays.map((w) => [...w.nodes]).filter((s) => s.length >= 2);
  const rings = [];
  while (segs.length) {
    const ring = segs.shift();
    let extended = true;
    while (extended && ring[0] !== ring[ring.length - 1]) {
      extended = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = ring[ring.length - 1];
        if (s[0] === end) { ring.push(...s.slice(1)); segs.splice(i, 1); extended = true; break; }
        if (s[s.length - 1] === end) { ring.push(...s.slice(0, -1).reverse()); segs.splice(i, 1); extended = true; break; }
      }
    }
    if (ring[0] === ring[ring.length - 1] && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function ringToCoords(ring) {
  const pts = [];
  for (const id of ring) {
    const nd = nodes.get(id);
    if (nd) pts.push(toLocal(nd.lon, nd.lat));
  }
  return pts;
}

// --- buildings ---
const buildings = [];
const relMemberWayIds = new Set();

for (const rel of rels) {
  if (!rel.tags?.building) continue;
  const outers = (rel.members || [])
    .filter((m) => m.type === "way" && (m.role === "outer" || m.role === ""))
    .map((m) => ways.get(m.ref))
    .filter(Boolean);
  for (const m of rel.members || []) if (m.type === "way") relMemberWayIds.add(m.ref);
  for (const ring of assembleRings(outers)) {
    const f = ringToCoords(ring);
    if (f.length < 4 || dist(centroid(f)) > CLIP_BUILDING) continue;
    f.pop(); // drop duplicated closing point
    const b = { f, h: parseHeight(rel.tags), t: rel.tags.building };
    if (rel.tags.name) b.n = rel.tags.name;
    buildings.push(b);
  }
}

for (const way of ways.values()) {
  const t = way.tags || {};
  if (!t.building || relMemberWayIds.has(way.id)) continue;
  if (way.nodes[0] !== way.nodes[way.nodes.length - 1]) continue;
  const f = wayCoords(way);
  if (f.length < 4 || dist(centroid(f)) > CLIP_BUILDING) continue;
  f.pop();
  const b = { f, h: parseHeight(t), t: t.building };
  if (t.name) b.n = t.name;
  if (t["building:levels"]) b.lv = parseFloat(t["building:levels"]) || undefined;
  buildings.push(b);
}

// --- roads / rails / platforms / green / water ---
const roads = [], rails = [], platforms = [], green = [], water = [];

for (const way of ways.values()) {
  const t = way.tags || {};
  const closed = way.nodes[0] === way.nodes[way.nodes.length - 1];

  if (t.highway && !ROAD_SKIP.has(t.highway) && !t.building) {
    const p = wayCoords(way);
    if (p.length < 2 || !p.some((pt) => dist(pt) <= CLIP_LINE)) continue;
    const road = {
      p,
      w: ROAD_WIDTHS[t.highway] ?? 4,
      t: t.highway,
    };
    if (t.bridge && t.bridge !== "no") road.b = 1;
    const ly = parseInt(t.layer, 10);
    if (!Number.isNaN(ly) && ly !== 0) road.ly = ly;
    roads.push(road);
  } else if (t.railway === "rail" || t.railway === "light_rail") {
    const p = wayCoords(way);
    if (p.length < 2 || !p.some((pt) => dist(pt) <= CLIP_LINE)) continue;
    const ly = parseInt(t.layer, 10) || 0;
    const elevated = (t.bridge && t.bridge !== "no") || ly > 0;
    const rail = { p, el: elevated ? Math.max(ly, 1) * 6 : 0 };
    if (t.name) rail.n = t.name;
    rails.push(rail);
  } else if (t.railway === "platform" && closed) {
    const f = wayCoords(way);
    if (f.length < 4 || dist(centroid(f)) > CLIP_LINE) continue;
    f.pop();
    const ly = parseInt(t.layer, 10) || 0;
    platforms.push({ f, el: ly > 0 ? ly * 6 : 0 });
  } else if ((GREEN_LEISURE.has(t.leisure) || GREEN_LANDUSE.has(t.landuse)) && closed) {
    const f = wayCoords(way);
    if (f.length < 4 || dist(centroid(f)) > CLIP_LINE) continue;
    f.pop();
    green.push({ f });
  } else if (t.natural === "water" && closed) {
    const f = wayCoords(way);
    if (f.length < 4 || dist(centroid(f)) > CLIP_LINE) continue;
    f.pop();
    water.push({ f });
  }
}

// --- POIs (for Phase 5 labels) ---
const pois = [];
for (const nd of nodes.values()) {
  const t = nd.tags;
  if (!t || !(t.shop || t.amenity || t.railway === "station")) continue;
  const [x, z] = toLocal(nd.lon, nd.lat);
  if (Math.hypot(x, z) > CLIP_POI) continue;
  const poi = { x, z, t: t.shop ? `shop:${t.shop}` : t.amenity ? `amenity:${t.amenity}` : "station" };
  if (t.name) poi.n = t.name;
  pois.push(poi);
}
pois.sort((a, b) => (b.n ? 1 : 0) - (a.n ? 1 : 0));
if (pois.length > 500) pois.length = 500;

// --- output ---
const city = {
  meta: {
    name: "Jiyugaoka Digital Twin city data v1",
    generated: new Date().toISOString(),
    fetched: fetchMeta.generated,
    origin_wgs84: [35.6075, 139.669],
    origin_epsg6677: [r2(ORIGIN_E), r2(ORIGIN_N)],
    radius_m: 300,
    units: "meters (x=east, z=south, y=up)",
    source: "OpenStreetMap via Overpass API",
    license: "ODbL 1.0 — (c) OpenStreetMap contributors — https://www.openstreetmap.org/copyright",
  },
  buildings, roads, rails, platforms, green, water, pois,
};

// sanity checks — fail loudly rather than publishing a broken/empty city
const fail = (msg) => { console.error(`ERROR: ${msg}`); process.exit(1); };
if (buildings.length < 300) fail(`too few buildings: ${buildings.length}`);
if (roads.length < 50) fail(`too few roads: ${roads.length}`);
if (rails.length < 2) fail(`too few rails: ${rails.length}`);

mkdirSync(OUT, { recursive: true });
mkdirSync(WEB_DATA, { recursive: true });
const json = JSON.stringify(city);
writeFileSync(join(OUT, "city.json"), json);
writeFileSync(
  join(OUT, "meta.json"),
  JSON.stringify({ ...fetchMeta, processed: city.meta.generated, counts: {
    buildings: buildings.length, roads: roads.length, rails: rails.length,
    platforms: platforms.length, green: green.length, water: water.length, pois: pois.length,
  } }, null, 2),
);
copyFileSync(join(OUT, "city.json"), join(WEB_DATA, "city.json"));

console.log(`buildings=${buildings.length} roads=${roads.length} rails=${rails.length} platforms=${platforms.length} green=${green.length} water=${water.length} pois=${pois.length}`);
console.log(`city.json: ${(json.length / 1024).toFixed(0)} KB (raw)`);
