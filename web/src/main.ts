import * as THREE from "three";
import { CameraRig } from "./cameras";
import { buildCity } from "./city";
import { Environment } from "./environment";
import { Simulation } from "./sim";
import { buildStreetscape } from "./streetscape";
import { makeLabelSprite } from "./textures";
import type { CityData } from "./types";
import { hideLoading, setupUi, showLoadingError } from "./ui";

async function init(): Promise<void> {
  const app = document.getElementById("app")!;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const rig = new CameraRig(renderer.domElement, window.innerWidth / window.innerHeight);

  // city data (OSM-derived, ODbL — (c) OpenStreetMap contributors)
  let data: CityData;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/city.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    showLoadingError(`都市データの読み込みに失敗しました (${e})`);
    return;
  }

  const city = buildCity(data);
  scene.add(city.group);
  scene.add(buildStreetscape(data, city.lightPositions));

  const sim = new Simulation(data);
  scene.add(sim.group);

  const stationLabel = makeLabelSprite("自由が丘駅", "Jiyugaoka Sta.");
  stationLabel.position.set(0, 34, 0);
  scene.add(stationLabel);

  const environment = new Environment(scene, city);

  setupUi({
    onMode: (mode) => {
      rig.setMode(mode);
      stationLabel.visible = mode !== "ground";
    },
    onTime: (time) => environment.apply(time),
    onJoystick: (x, y) => rig.setJoystick(x, y),
  });

  window.addEventListener("resize", () => {
    rig.camera.aspect = window.innerWidth / window.innerHeight;
    rig.camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // optional FPS HUD (?debug)
  const fpsEl = document.getElementById("fps")!;
  const debug = new URLSearchParams(location.search).has("debug");
  if (debug) fpsEl.style.display = "block";
  let frames = 0;
  let fpsTime = performance.now();

  const clock = new THREE.Clock();
  let time = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    time += dt;
    rig.update(dt);
    sim.update(dt, time);
    renderer.render(scene, rig.camera);
    if (debug) {
      frames++;
      const now = performance.now();
      if (now - fpsTime >= 1000) {
        fpsEl.textContent = `${frames} fps / draws ${renderer.info.render.calls} / tris ${renderer.info.render.triangles}`;
        frames = 0;
        fpsTime = now;
      }
    }
  });

  hideLoading();
}

init();
