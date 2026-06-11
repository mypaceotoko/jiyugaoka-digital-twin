import * as THREE from "three";
import type { CityMeshes } from "./city";

export type TimeOfDay = "day" | "dusk" | "night";

interface Preset {
  skyZenith: number;
  skyHorizon: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
  sunIntensity: number;
  sunPos: [number, number, number];
  exposure: number;
  ground: number;
  windowGlow: number; // upper-facade emissive intensity
  shopGlow: number; // storefront emissive intensity
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    skyZenith: 0x3f7fd0, skyHorizon: 0xcfe3ee, fog: 0xc9dbe6, fogNear: 280, fogFar: 900,
    hemiSky: 0xffffff, hemiGround: 0x9a9486, hemiIntensity: 1.25,
    sun: 0xfff2dd, sunIntensity: 2.8, sunPos: [260, 380, 170],
    exposure: 1.0, ground: 0xcfcabc, windowGlow: 0, shopGlow: 0,
  },
  dusk: {
    skyZenith: 0x4a3a6e, skyHorizon: 0xf0945a, fog: 0xc98a68, fogNear: 220, fogFar: 750,
    hemiSky: 0xffb98a, hemiGround: 0x5a4a4a, hemiIntensity: 0.7,
    sun: 0xff8e4e, sunIntensity: 1.7, sunPos: [-420, 110, 170],
    exposure: 1.05, ground: 0xa9937f, windowGlow: 0.65, shopGlow: 1.1,
  },
  night: {
    skyZenith: 0x060a1c, skyHorizon: 0x1c2440, fog: 0x0b1026, fogNear: 150, fogFar: 600,
    hemiSky: 0x2a3050, hemiGround: 0x121018, hemiIntensity: 0.5,
    sun: 0x88aaff, sunIntensity: 0.38, sunPos: [-180, 320, -260],
    exposure: 0.95, ground: 0x26272e, windowGlow: 1.5, shopGlow: 2.0,
  },
};

// day-cycle keyframes for the timelapse (dawn reuses the dusk palette)
const TIMELINE: { h: number; p: Preset }[] = [
  { h: 0, p: PRESETS.night },
  { h: 4.8, p: PRESETS.night },
  { h: 6.3, p: PRESETS.dusk },
  { h: 9, p: PRESETS.day },
  { h: 15.5, p: PRESETS.day },
  { h: 18.0, p: PRESETS.dusk },
  { h: 20.2, p: PRESETS.night },
  { h: 24, p: PRESETS.night },
];
const PRESET_HOUR: Record<TimeOfDay, number> = { day: 13, dusk: 18.0, night: 22 };

function smoothstep(x: number, a: number, b: number): number {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function makeDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1100, 24, 14);
  const count = geo.attributes.position.count;
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.name = "sky";
  dome.renderOrder = -1;
  return dome;
}

function paintDome(dome: THREE.Mesh, zenith: THREE.Color, horizon: THREE.Color): void {
  const geo = dome.geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position;
  const col = geo.attributes.color as THREE.BufferAttribute;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // t: 0 at/below horizon, 1 at zenith (bias toward horizon for a soft band)
    const t = Math.pow(THREE.MathUtils.clamp(pos.getY(i) / 1100, 0, 1), 0.55);
    c.lerpColors(horizon, zenith, t);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

export class Environment {
  current: TimeOfDay = "day";
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private dome: THREE.Mesh;
  private pmrem: THREE.PMREMGenerator;
  private envCache = new Map<TimeOfDay, THREE.Texture>();
  private colA = new THREE.Color();
  private colB = new THREE.Color();

  constructor(
    private scene: THREE.Scene,
    private city: CityMeshes,
    private renderer: THREE.WebGLRenderer,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x9a9486, 1.25);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -300;
    sc.right = 300;
    sc.top = 300;
    sc.bottom = -300;
    sc.near = 50;
    sc.far = 1100;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 2.5;
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.hemi, this.sun, this.sun.target);

    this.dome = makeDome();
    scene.add(this.dome);

    this.apply("day");
  }

  /** 0 = full (2048 shadow), 1 = reduced (1024), 2 = shadows off */
  setShadowQuality(level: 0 | 1 | 2): void {
    if (level === 2) {
      this.renderer.shadowMap.enabled = false;
      this.sun.castShadow = false;
      return;
    }
    this.renderer.shadowMap.enabled = true;
    this.sun.castShadow = true;
    const size = level === 0 ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  apply(time: TimeOfDay): void {
    this.current = time;
    this.applyHour(PRESET_HOUR[time]);
  }

  /** Continuous time of day for the timelapse mode (hour: 0–24). */
  applyHour(hour: number): void {
    let i = 1;
    while (i < TIMELINE.length - 1 && TIMELINE[i].h < hour) i++;
    const a = TIMELINE[i - 1];
    const b = TIMELINE[i];
    const t = THREE.MathUtils.clamp((hour - a.h) / (b.h - a.h || 1), 0, 1);
    this.blend(a.p, b.p, t, hour);
  }

  private envKeyFor(hour: number): TimeOfDay {
    if (hour < 5.5 || hour >= 19.5) return "night";
    if (hour < 8.2 || hour >= 16.8) return "dusk";
    return "day";
  }

  private ensureEnv(key: TimeOfDay): THREE.Texture {
    let env = this.envCache.get(key);
    if (!env) {
      const p = PRESETS[key];
      const tmp = new THREE.Scene();
      const tmpDome = makeDome();
      paintDome(tmpDome, new THREE.Color(p.skyZenith), new THREE.Color(p.skyHorizon));
      tmp.add(tmpDome);
      env = this.pmrem.fromScene(tmp, 0.04).texture;
      this.envCache.set(key, env);
    }
    return env;
  }

  private blend(a: Preset, b: Preset, t: number, hour: number): void {
    const lerp = THREE.MathUtils.lerp;
    const col = (x: number, y: number) => this.colA.setHex(x).lerp(this.colB.setHex(y), t);

    paintDome(
      this.dome,
      col(a.skyZenith, b.skyZenith).clone(),
      this.colB.setHex(a.skyHorizon).lerp(new THREE.Color(b.skyHorizon), t).clone(),
    );
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(
      col(a.fog, b.fog).getHex(),
      lerp(a.fogNear, b.fogNear, t),
      lerp(a.fogFar, b.fogFar, t),
    );
    this.scene.environment = this.ensureEnv(this.envKeyFor(hour));
    this.scene.environmentIntensity = 0.55;

    this.hemi.color.copy(col(a.hemiSky, b.hemiSky));
    this.hemi.groundColor.copy(col(a.hemiGround, b.hemiGround));
    this.hemi.intensity = lerp(a.hemiIntensity, b.hemiIntensity, t);
    this.sun.color.copy(col(a.sun, b.sun));
    this.sun.intensity = lerp(a.sunIntensity, b.sunIntensity, t);

    // sun sweeps east -> zenith -> west across the day, blends to a static
    // "moon" position at night
    const angle = (Math.PI * (hour - 6)) / 12;
    const sunX = Math.cos(angle) * 430;
    const sunY = Math.max(Math.sin(angle), 0.07) * 400 + 30;
    const nightBlend =
      hour > 12 ? smoothstep(hour, 18.4, 20.2) : 1 - smoothstep(hour, 4.8, 6.4);
    const night = PRESETS.night.sunPos;
    this.sun.position.set(
      lerp(sunX, night[0], nightBlend),
      lerp(sunY, night[1], nightBlend),
      lerp(160, night[2], nightBlend),
    );

    this.renderer.toneMappingExposure = lerp(a.exposure, b.exposure, t);
    (this.city.ground.material as THREE.MeshLambertMaterial).color.copy(col(a.ground, b.ground));
    const windowGlow = lerp(a.windowGlow, b.windowGlow, t);
    this.city.buildingMaterial.emissiveIntensity = windowGlow;
    this.city.storefrontMaterial.emissiveIntensity = lerp(a.shopGlow, b.shopGlow, t);
    this.city.streetLights.visible = windowGlow > 0.08;
  }
}
