import * as THREE from "three";
import type { CityMeshes } from "./city";

export type TimeOfDay = "day" | "dusk" | "night";

interface Preset {
  sky: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
  sunIntensity: number;
  sunPos: [number, number, number];
  ground: number;
  windowGlow: number; // facade emissiveMap intensity
  lights: boolean;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    sky: 0xa8cce3, fog: 0xc4d6e2, fogNear: 260, fogFar: 850,
    hemiSky: 0xffffff, hemiGround: 0x8a8578, hemiIntensity: 1.05,
    sun: 0xfff3e0, sunIntensity: 2.0, sunPos: [140, 200, 90],
    ground: 0xcfcabc, windowGlow: 0,
    lights: false,
  },
  dusk: {
    sky: 0xd98e66, fog: 0xc98a68, fogNear: 200, fogFar: 700,
    hemiSky: 0xffb98a, hemiGround: 0x5a4a4a, hemiIntensity: 0.55,
    sun: 0xff9e5e, sunIntensity: 1.3, sunPos: [-180, 45, 70],
    ground: 0xa9937f, windowGlow: 0.55,
    lights: true,
  },
  night: {
    sky: 0x0b1026, fog: 0x0b1026, fogNear: 140, fogFar: 550,
    hemiSky: 0x2a3050, hemiGround: 0x121018, hemiIntensity: 0.42,
    sun: 0x88aaff, sunIntensity: 0.32, sunPos: [-80, 160, -120],
    ground: 0x26272e, windowGlow: 1.25,
    lights: true,
  },
};

export class Environment {
  current: TimeOfDay = "day";
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;

  constructor(
    private scene: THREE.Scene,
    private city: CityMeshes,
  ) {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8578, 1.05);
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.0);
    scene.add(this.hemi, this.sun);
    this.apply("day");
  }

  apply(time: TimeOfDay): void {
    this.current = time;
    const p = PRESETS[time];
    this.scene.background = new THREE.Color(p.sky);
    this.scene.fog = new THREE.Fog(p.fog, p.fogNear, p.fogFar);
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.sun.color.setHex(p.sun);
    this.sun.intensity = p.sunIntensity;
    this.sun.position.set(...p.sunPos);
    (this.city.ground.material as THREE.MeshLambertMaterial).color.setHex(p.ground);
    this.city.buildingMaterial.emissiveIntensity = p.windowGlow;
    this.city.streetLights.visible = p.lights;
  }
}
