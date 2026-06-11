import * as THREE from "three";
import type { Simulation } from "./sim";
import type { Poi } from "./types";

/**
 * "City monitor" overlay: detection-style boxes over moving agents and
 * floating labels for named POIs, rendered as pooled DOM elements projected
 * from world space (crisp on mobile, no extra draw calls).
 */

const MAX_POI = 16;
const MAX_DET = 22;
const POI_RANGE = 230; // m
const DET_RANGE = 170; // m

interface PoiEntry {
  x: number;
  z: number;
  name: string;
  tag: string;
}

export class Monitor {
  enabled = false;
  private root: HTMLDivElement;
  private hud: HTMLDivElement;
  private poiEls: HTMLDivElement[] = [];
  private detEls: HTMLDivElement[] = [];
  private pois: PoiEntry[] = [];
  private v = new THREE.Vector3();
  private frame = 0;

  constructor(pois: Poi[]) {
    this.root = document.createElement("div");
    this.root.id = "monitor";
    document.body.appendChild(this.root);

    this.hud = document.createElement("div");
    this.hud.id = "monitor-hud";
    this.root.appendChild(this.hud);

    for (let i = 0; i < MAX_POI; i++) {
      const el = document.createElement("div");
      el.className = "poi-label";
      this.root.appendChild(el);
      this.poiEls.push(el);
    }
    for (let i = 0; i < MAX_DET; i++) {
      const el = document.createElement("div");
      el.className = "det-box";
      el.innerHTML = "<span></span>";
      this.root.appendChild(el);
      this.detEls.push(el);
    }

    this.pois = pois
      .filter((p) => p.n)
      .map((p) => ({
        x: p.x,
        z: p.z,
        name: p.n!.length > 14 ? p.n!.slice(0, 13) + "…" : p.n!,
        tag: p.t.replace(/^(shop|amenity):/, "").toUpperCase(),
      }));

    this.setEnabled(false);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.root.style.display = on ? "block" : "none";
  }

  /** Project world position to CSS pixels; returns false if behind camera. */
  private project(camera: THREE.PerspectiveCamera, x: number, y: number, z: number): { sx: number; sy: number; d2: number } | null {
    const dx = x - camera.position.x;
    const dy = y - camera.position.y;
    const dz = z - camera.position.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    this.v.set(x, y, z).project(camera);
    if (this.v.z < -1 || this.v.z > 1) return null;
    if (this.v.x < -1.05 || this.v.x > 1.05 || this.v.y < -1.1 || this.v.y > 1.1) return null;
    return {
      sx: (this.v.x * 0.5 + 0.5) * window.innerWidth,
      sy: (-this.v.y * 0.5 + 0.5) * window.innerHeight,
      d2,
    };
  }

  update(camera: THREE.PerspectiveCamera, sim: Simulation): void {
    if (!this.enabled) return;
    this.frame++;
    if (this.frame % 2) return; // 30 Hz is plenty for DOM updates

    const cx = camera.position.x;
    const cz = camera.position.z;

    // --- POI labels: nearest named shops/amenities ---
    const nearPois = this.pois
      .map((p) => ({ p, d2: (p.x - cx) ** 2 + (p.z - cz) ** 2 }))
      .filter((e) => e.d2 < POI_RANGE * POI_RANGE)
      .sort((a, b) => a.d2 - b.d2)
      .slice(0, MAX_POI);
    let pi = 0;
    for (const { p } of nearPois) {
      const pr = this.project(camera, p.x, 7 + (pi % 3) * 2.4, p.z);
      if (!pr) continue;
      const el = this.poiEls[pi++];
      el.style.display = "block";
      el.style.transform = `translate3d(${pr.sx.toFixed(0)}px, ${pr.sy.toFixed(0)}px, 0)`;
      el.textContent = `${p.name} · ${p.tag}`;
    }
    for (; pi < MAX_POI; pi++) this.poiEls[pi].style.display = "none";

    // --- detection boxes over agents ---
    const candidates: { x: number; y: number; z: number; id: string; cls: string; d2: number }[] = [];
    const collect = (arr: { x: number; y: number; z: number; id: string }[], cls: string, range: number) => {
      for (const a of arr) {
        const d2 = (a.x - cx) ** 2 + (a.z - cz) ** 2;
        if (d2 < range * range) candidates.push({ ...a, cls, d2 });
      }
    };
    collect(sim.walkerSnapshots, "ped", DET_RANGE);
    collect(sim.carSnapshots, "veh", DET_RANGE);
    collect(sim.busSnapshots, "bus", DET_RANGE + 80);
    collect(sim.trainSnapshots, "trn", 600);
    candidates.sort((a, b) => a.d2 - b.d2);

    let di = 0;
    for (const c of candidates) {
      if (di >= MAX_DET) break;
      const pr = this.project(camera, c.x, c.y, c.z);
      if (!pr) continue;
      const el = this.detEls[di++];
      const dist = Math.sqrt(pr.d2);
      const size =
        THREE.MathUtils.clamp(900 / dist, 14, 52) *
        (c.cls === "trn" ? 2.2 : c.cls === "bus" ? 1.8 : c.cls === "veh" ? 1.4 : 1);
      el.style.display = "block";
      el.dataset.cls = c.cls;
      el.style.width = `${size.toFixed(0)}px`;
      el.style.height = `${size.toFixed(0)}px`;
      el.style.transform = `translate3d(${(pr.sx - size / 2).toFixed(0)}px, ${(pr.sy - size / 2).toFixed(0)}px, 0)`;
      (el.firstChild as HTMLSpanElement).textContent = `${c.id} ${(0.86 + ((c.id.charCodeAt(4) * 7) % 13) / 100).toFixed(2)}`;
    }
    for (; di < MAX_DET; di++) this.detEls[di].style.display = "none";

    // --- HUD ---
    this.hud.innerHTML =
      `<b>JIYUGAOKA CITY MONITOR</b><br>` +
      `PED ${sim.walkerSnapshots.length} · VEH ${sim.carSnapshots.length} · BUS ${sim.busSnapshots.length} · TRN ${sim.trainSnapshots.length}<br>` +
      `CAM E${cx.toFixed(0)} N${(-cz).toFixed(0)} ALT${camera.position.y.toFixed(0)}`;
  }
}
