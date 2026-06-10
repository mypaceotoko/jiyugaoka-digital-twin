import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type CameraMode = "aerial" | "ground" | "cinematic";

const WALK_SPEED = 5; // m/s
const EYE_HEIGHT = 1.7;
const AREA_LIMIT = 310;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = "aerial";

  private controls: OrbitControls;
  private joystick: { x: number; y: number } = { x: 0, y: 0 };
  private keys = new Set<string>();
  private yaw = Math.PI; // facing north (toward -z... station front)
  private pitch = -0.05;
  private walkPos = new THREE.Vector3(-20, EYE_HEIGHT, -60);
  private cineT = 0;
  private lookDrag: { id: number; x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1500);
    this.camera.position.set(180, 220, 180);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.maxPolarAngle = 1.48;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 700;
    this.controls.enableDamping = true;

    // ground-mode look: drag anywhere on the canvas
    canvas.addEventListener("pointerdown", (e) => {
      if (this.mode !== "ground") return;
      this.lookDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.mode !== "ground" || !this.lookDrag || e.pointerId !== this.lookDrag.id) return;
      this.yaw -= (e.clientX - this.lookDrag.x) * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (e.clientY - this.lookDrag.y) * 0.004, -1.2, 1.2);
      this.lookDrag.x = e.clientX;
      this.lookDrag.y = e.clientY;
    });
    const endDrag = (e: PointerEvent) => {
      if (this.lookDrag?.id === e.pointerId) this.lookDrag = null;
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    window.addEventListener("keydown", (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
  }

  setJoystick(x: number, y: number): void {
    this.joystick.x = x;
    this.joystick.y = y;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.controls.enabled = mode === "aerial";
    if (mode === "aerial") {
      this.camera.position.set(180, 220, 180);
      this.controls.target.set(0, 0, 0);
    } else if (mode === "ground") {
      this.walkPos.set(-20, EYE_HEIGHT, -60); // near the station front
      this.yaw = Math.PI * 0.75;
      this.pitch = -0.02;
    } else {
      this.cineT = 0;
    }
  }

  update(dt: number): void {
    if (this.mode === "aerial") {
      this.controls.update();
      return;
    }
    if (this.mode === "ground") {
      let mx = this.joystick.x;
      let my = this.joystick.y;
      if (this.keys.has("w") || this.keys.has("arrowup")) my -= 1;
      if (this.keys.has("s") || this.keys.has("arrowdown")) my += 1;
      if (this.keys.has("a") || this.keys.has("arrowleft")) mx -= 1;
      if (this.keys.has("d") || this.keys.has("arrowright")) mx += 1;
      const len = Math.hypot(mx, my);
      if (len > 1) {
        mx /= len;
        my /= len;
      }
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // joystick up (my = -1) moves forward along view direction
      this.walkPos.x += (-my * sin + mx * cos) * WALK_SPEED * dt;
      this.walkPos.z += (-my * cos - mx * sin) * WALK_SPEED * dt;
      const r = Math.hypot(this.walkPos.x, this.walkPos.z);
      if (r > AREA_LIMIT) {
        this.walkPos.x *= AREA_LIMIT / r;
        this.walkPos.z *= AREA_LIMIT / r;
      }
      this.camera.position.copy(this.walkPos);
      const dir = new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch),
      );
      this.camera.lookAt(this.walkPos.clone().add(dir));
      return;
    }
    // cinematic: slow drifting orbit with breathing radius/height
    this.cineT += dt;
    const t = this.cineT;
    const radius = 170 + 70 * Math.sin(t * 0.045);
    const height = 75 + 50 * Math.sin(t * 0.03 + 1.2);
    const ang = t * 0.055;
    this.camera.position.set(Math.cos(ang) * radius, height, Math.sin(ang) * radius);
    this.camera.lookAt(0, 10, 0);
  }
}
