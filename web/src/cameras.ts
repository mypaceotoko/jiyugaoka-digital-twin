import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type CameraMode = "aerial" | "ground" | "cinematic";

const WALK_SPEED = 5; // m/s
const EYE_HEIGHT = 1.7;
const AREA_LIMIT = 310;
const HOME_POS = new THREE.Vector3(180, 220, 180);
const HOME_TARGET = new THREE.Vector3(0, 0, 0);

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface Fly {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTgt: THREE.Vector3;
  toTgt: THREE.Vector3;
  t: number;
  dur: number;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = "aerial";
  /** notified when aerial tap-focus starts/ends (drives the "overview" button) */
  onAerialFocus?: (focused: boolean) => void;

  private controls: OrbitControls;
  private joystick: { x: number; y: number } = { x: 0, y: 0 };
  private keys = new Set<string>();
  private yaw = Math.PI; // facing north (toward -z... station front)
  private pitch = -0.05;
  private walkPos = new THREE.Vector3(-20, EYE_HEIGHT, -60);
  private cineT = 0;
  private lookDrag: { id: number; x: number; y: number } | null = null;
  private fly: Fly | null = null;
  private focused = false;
  private tap: { id: number; x: number; y: number; time: number } | null = null;
  private activePointers = 0;

  constructor(canvas: HTMLCanvasElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1500);
    this.camera.position.copy(HOME_POS);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(HOME_TARGET);
    this.controls.maxPolarAngle = 1.48;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 700;
    this.controls.enableDamping = true;

    canvas.addEventListener("pointerdown", (e) => {
      this.activePointers++;
      if (this.mode === "ground") {
        this.lookDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      } else if (this.mode === "aerial" && this.activePointers === 1) {
        this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now() };
      } else {
        this.tap = null; // multi-touch (pinch) is never a tap
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.mode !== "ground" || !this.lookDrag || e.pointerId !== this.lookDrag.id) return;
      this.yaw -= (e.clientX - this.lookDrag.x) * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (e.clientY - this.lookDrag.y) * 0.004, -1.2, 1.2);
      this.lookDrag.x = e.clientX;
      this.lookDrag.y = e.clientY;
    });
    const endPointer = (e: PointerEvent) => {
      this.activePointers = Math.max(0, this.activePointers - 1);
      if (this.lookDrag?.id === e.pointerId) this.lookDrag = null;
      if (this.tap && e.pointerId === this.tap.id) {
        const moved = Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y);
        const dt = performance.now() - this.tap.time;
        const tap = this.tap;
        this.tap = null;
        if (this.mode === "aerial" && moved < 8 && dt < 350) {
          this.handleAerialTap(tap.x, tap.y, canvas);
        }
      }
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);

    window.addEventListener("keydown", (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
  }

  /** Tap in aerial mode: raycast to the ground plane and fly the camera there. */
  private handleAerialTap(clientX: number, clientY: number, canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const dir = ray.ray.direction;
    if (dir.y >= -0.01) return; // looking at the sky
    const t = -ray.ray.origin.y / dir.y;
    const hit = ray.ray.origin.clone().addScaledVector(dir, t);
    // keep the focus point inside the city
    const r = Math.hypot(hit.x, hit.z);
    if (r > 300) {
      hit.x *= 300 / r;
      hit.z *= 300 / r;
    }
    this.focusOn(hit);
  }

  /** Fly down to a street-level orbit around the given point. */
  focusOn(point: THREE.Vector3): void {
    const tgt = new THREE.Vector3(point.x, 4, point.z);
    // approach keeping the current viewing direction
    const dir = this.camera.position.clone().sub(this.controls.target).setY(0);
    if (dir.lengthSq() < 1) dir.set(1, 0, 1);
    dir.normalize();
    const pos = tgt.clone().addScaledVector(dir, 52).setY(38);
    this.startFly(pos, tgt, 1.1);
    if (!this.focused) {
      this.focused = true;
      this.onAerialFocus?.(true);
    }
  }

  /** Fly back to the full-city overview. */
  resetAerial(): void {
    if (this.mode !== "aerial") return;
    this.startFly(HOME_POS.clone(), HOME_TARGET.clone(), 1.0);
    if (this.focused) {
      this.focused = false;
      this.onAerialFocus?.(false);
    }
  }

  private startFly(toPos: THREE.Vector3, toTgt: THREE.Vector3, dur: number): void {
    this.fly = {
      fromPos: this.camera.position.clone(),
      toPos,
      fromTgt: this.controls.target.clone(),
      toTgt,
      t: 0,
      dur,
    };
    this.controls.enabled = false;
  }

  setJoystick(x: number, y: number): void {
    this.joystick.x = x;
    this.joystick.y = y;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.fly = null;
    if (this.focused) {
      this.focused = false;
      this.onAerialFocus?.(false);
    }
    this.controls.enabled = mode === "aerial";
    if (mode === "aerial") {
      this.camera.position.copy(HOME_POS);
      this.controls.target.copy(HOME_TARGET);
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
      if (this.fly) {
        const f = this.fly;
        f.t = Math.min(f.t + dt / f.dur, 1);
        const e = easeInOutCubic(f.t);
        this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
        this.controls.target.lerpVectors(f.fromTgt, f.toTgt, e);
        this.camera.lookAt(this.controls.target);
        if (f.t >= 1) {
          this.fly = null;
          this.controls.enabled = true;
        }
        return;
      }
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
