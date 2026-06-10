import * as THREE from "three";

/**
 * Procedural facade textures (no asset downloads, mobile-friendly).
 * One tile = one window cell (~3.2 m x 3.2 m of wall).
 */
export interface FacadeTextures {
  map: THREE.Texture;
  emissiveMap: THREE.Texture;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return [c, c.getContext("2d")!];
}

export function makeFacadeTextures(): FacadeTextures {
  const S = 128;

  // base wall with one window
  const [wallC, wall] = makeCanvas(S);
  wall.fillStyle = "#ffffff";
  wall.fillRect(0, 0, S, S);
  // subtle horizontal floor line
  wall.fillStyle = "rgba(0,0,0,0.08)";
  wall.fillRect(0, S - 4, S, 4);
  // window: frame + glass
  const wx = S * 0.22, wy = S * 0.2, ww = S * 0.56, wh = S * 0.5;
  wall.fillStyle = "#9b9b96";
  wall.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
  const glass = wall.createLinearGradient(0, wy, 0, wy + wh);
  glass.addColorStop(0, "#6f7c86");
  glass.addColorStop(1, "#4d575f");
  wall.fillStyle = glass;
  wall.fillRect(wx, wy, ww, wh);
  // mullion
  wall.fillStyle = "#9b9b96";
  wall.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);

  const map = new THREE.CanvasTexture(wallC);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  // emissive: some windows lit (warm), rest dark — drawn on a larger tile
  // (4x4 cells) so the lit pattern varies across the facade
  const E = S * 4;
  const [emiC, emi] = makeCanvas(E);
  emi.fillStyle = "#000000";
  emi.fillRect(0, 0, E, E);
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      if (Math.random() < 0.45) continue; // dark window
      const ox = cx * S, oy = cy * S;
      const warm = 200 + Math.floor(Math.random() * 55);
      emi.fillStyle = `rgb(${warm},${Math.floor(warm * 0.82)},${Math.floor(warm * 0.5)})`;
      emi.fillRect(ox + wx, oy + wy, ww, wh);
    }
  }
  const emissiveMap = new THREE.CanvasTexture(emiC);
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  // emissive tile covers 4x4 wall cells
  emissiveMap.repeat.set(0.25, 0.25);

  return { map, emissiveMap };
}

/** Floating text label (e.g. station name). */
export function makeLabelSprite(text: string, sub?: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  g.lineWidth = 8;
  g.strokeStyle = "rgba(10,14,30,0.85)";
  g.fillStyle = "#ffffff";
  g.font = "bold 72px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
  g.strokeText(text, 256, 78);
  g.fillText(text, 256, 78);
  if (sub) {
    g.font = "500 34px 'Hiragino Sans', sans-serif";
    g.strokeText(sub, 256, 130);
    g.fillText(sub, 256, 130);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }),
  );
  sprite.scale.set(48, 15, 1);
  return sprite;
}
