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
  lights: boolean;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    skyZenith: 0x3f7fd0, skyHorizon: 0xcfe3ee, fog: 0xc9dbe6, fogNear: 280, fogFar: 900,
    hemiSky: 0xffffff, hemiGround: 0x9a9486, hemiIntensity: 1.25,
    sun: 0xfff2dd, sunIntensity: 2.8, sunPos: [260, 380, 170],
    exposure: 1.0, ground: 0xcfcabc, windowGlow: 0, shopGlow: 0,
    lights: false,
  },
  dusk: {
    skyZenith: 0x4a3a6e, skyHorizon: 0xf0945a, fog: 0xc98a68, fogNear: 220, fogFar: 750,
    hemiSky: 0xffb98a, hemiGround: 0x5a4a4a, hemiIntensity: 0.7,
    sun: 0xff8e4e, sunIntensity: 1.7, sunPos: [-420, 110, 170],
    exposure: 1.05, ground: 0xa9937f, windowGlow: 0.65, shopGlow: 1.1,
    lights: true,
  },
  night: {
    skyZenith: 0x060a1c, skyHorizon: 0x1c2440, fog: 0x0b1026, fogNear: 150, fogFar: 600,
    hemiSky: 0x2a3050, hemiGround: 0x121018, hemiIntensity: 0.5,
    sun: 0x88aaff, sunIntensity: 0.38, sunPos: [-180, 320, -260],
    exposure: 0.95, ground: 0x26272e, windowGlow: 1.5, shopGlow: 2.0,
    lights: true,
  },
};

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

function paintDome(dome: THREE.Mesh, zenithHex: number, horizonHex: number): void {
  const geo = dome.geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position;
  const col = geo.attributes.color as THREE.BufferAttribute;
  const zenith = new THREE.Color(zenithHex);
  const horizon = new THREE.Color(horizonHex);
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
    const p = PRESETS[time];

    paintDome(this.dome, p.skyZenith, p.skyHorizon);
    this.scene.fog = new THREE.Fog(p.fog, p.fogNear, p.fogFar);
    this.scene.background = null;

    // image-based ambient from the sky gradient (cached per preset)
    let env = this.envCache.get(time);
    if (!env) {
      const tmp = new THREE.Scene();
      const tmpDome = makeDome();
      paintDome(tmpDome, p.skyZenith, p.skyHorizon);
      tmp.add(tmpDome);
      env = this.pmrem.fromScene(tmp, 0.04).texture;
      this.envCache.set(time, env);
    }
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;

    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.sun.color.setHex(p.sun);
    this.sun.intensity = p.sunIntensity;
    this.sun.position.set(...p.sunPos);
    this.renderer.toneMappingExposure = p.exposure;

    (this.city.ground.material as THREE.MeshLambertMaterial).color.setHex(p.ground);
    this.city.buildingMaterial.emissiveIntensity = p.windowGlow;
    this.city.storefrontMaterial.emissiveIntensity = p.shopGlow;
    this.city.streetLights.visible = p.lights;
  }
}
