import * as THREE from "three";
import { CameraRig } from "./cameras";
import { Monitor } from "./monitor";
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

  const environment = new Environment(scene, city, renderer);
  const monitor = new Monitor(data.pois);

  setupUi({
    onMode: (mode) => {
      rig.setMode(mode);
      stationLabel.visible = mode !== "ground";
    },
    onTime: (time) => environment.apply(time),
    onJoystick: (x, y) => rig.setJoystick(x, y),
    onMonitor: (on) => monitor.setEnabled(on),
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

  // auto performance tier: drop pixelRatio if sustained low fps
  let degradeFrames = 0;
  let degradeTime = performance.now();
  let tier = 0;
  setInterval(() => {
    const now = performance.now();
    const fps = (degradeFrames * 1000) / (now - degradeTime);
    degradeFrames = 0;
    degradeTime = now;
    if (fps > 5 && fps < 24 && tier < 3) {
      tier++;
      if (tier === 1) {
        environment.setShadowQuality(1); // smaller shadow map first
      } else if (tier === 2) {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setSize(window.innerWidth, window.innerHeight);
      } else {
        environment.setShadowQuality(2); // shadows off as a last resort
        renderer.setPixelRatio(1);
        renderer.setSize(window.innerWidth, window.innerHeight);
      }
    }
  }, 3000);

  const clock = new THREE.Clock();
  let time = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    time += dt;
    rig.update(dt);
    sim.update(dt, time);
    monitor.update(rig.camera, sim);
    renderer.render(scene, rig.camera);
    degradeFrames++;
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

  // PWA: cache app shell + city data for instant repeat visits
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  }
}

init();
